import { rpc, Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk'
import type {
  ArchivedLedgerEntry,
  DryRunResult,
  ExpiredTransactionInfo,
  ResurrectResult,
  RestoreKeysOptions,
  SubmitLifecycleEvent,
  SubmitWithRestoreOptions,
  WalletAdapter,
} from './types.js'
import type { SubmitWithRestoreRequestOptions } from './RequestConfigOverrides.js'
import { resolveSubmitConfig } from './RequestConfigOverrides.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import { executeWithRestore, sendTransaction as _sendTransaction } from './Executor.js'
import {
  buildRestoreTransaction,
  buildBatchRestoreTransaction,
  buildRestoreTransactionFromKeys,
  buildOriginalAfterRestore,
  resolveRestoreMemo,
  waitForTransaction,
  extractXdrOperations,
  getExpiredTransactionInfo,
} from './Restorer.js'
import {
  isRestoreResponse,
  isErrorResponse,
  isSuccessResponse,
  extractArchivedKeys,
} from './Archiver.js'
import { TransactionHistory, TransactionHistoryEntry } from './TransactionHistory.js'
import { attachHistoryPersistence, type HistoryPersistenceHandle } from './HistoryPersistence.js'
import { SorobanResurrectStateManager } from './SorobanResurrectState.js'
import { SorobanResurrectSimulator } from './SorobanResurrectSimulation.js'
import { asTxHash, asHistoryEntryId } from './branded-types.js'
import type { AbortSignalOptions } from './AbortUtils.js'
import { runWithSignal } from './AbortUtils.js'

/**
 * Handles all transaction execution concerns for a `SorobanResurrect` instance:
 *
 * - `submitWithRestore` — full restore-and-submit workflow with state updates,
 *   typed event emission, and history recording.
 * - `sendTransaction` — lightweight direct submit (no restore logic).
 * - `buildRestoreTx` — builds an unsigned restore transaction.
 * - `retry` — re-runs a previously recorded workflow by history entry id.
 * - `submitBatchWithRestore` — sequential multi-transaction submission.
 * - History accessors (`history`, `getHistory`, `clearHistory`).
 *
 * This class depends on `SorobanResurrectStateManager` for state transitions
 * and `SorobanResurrectSimulator` for simulation / archive detection.
 */
export class SorobanResurrectExecutor {
  private _server: ISorobanRpcClient
  private _config: Required<SorobanResurrectConfig>
  private readonly _stateMgr: SorobanResurrectStateManager
  private readonly _simulator: SorobanResurrectSimulator
  private readonly _history: TransactionHistory
  private readonly _historyPersistence: HistoryPersistenceHandle | null
  private readonly _inFlightRequests = new Map<string, Promise<ResurrectResult>>()

  /**
   * @param server    - Soroban RPC client instance.
   * @param config    - Fully resolved SDK configuration.
   * @param stateMgr  - Shared state manager for state transitions and events.
   * @param simulator - Simulation/detection helper for the same instance.
   */
  constructor(
    server: ISorobanRpcClient,
    config: Required<SorobanResurrectConfig>,
    stateMgr: SorobanResurrectStateManager,
    simulator: SorobanResurrectSimulator,
    persistHistory?: HistoryPersistenceOptions,
  ) {
    this._server = server
    this._config = config
    this._stateMgr = stateMgr
    this._simulator = simulator
    this._history = new TransactionHistory(config.networkPassphrase)
    this._historyPersistence = persistHistory
      ? attachHistoryPersistence(this._history, persistHistory.storage, persistHistory.key, {
          mode: persistHistory.mode,
          serializer: persistHistory.serializer,
        })
      : null
  }

  /**
   * Resolves once transaction history has been hydrated from durable storage.
   * When persistence is disabled this resolves immediately.
   */
  get historyHydrated(): Promise<void> {
    return this._historyPersistence?.hydrated ?? Promise.resolve()
  }

  /** Stops history persistence when this executor is no longer in use. */
  dispose(): void {
    this._historyPersistence?.detach()
  }

  /**
   * Simulates a transaction and returns restore requirements, fee estimate,
   * and operation types without accessing a wallet or submitting a transaction.
   */
  async previewRestore(transaction: Transaction): Promise<DryRunResult> {
    const intendedOperations = extractXdrOperations(transaction).map(
      (operation) => operation.body().switch().name,
    )

    let response: rpc.Api.SimulateTransactionResponse
    try {
      response = await this._simulator.simulate(transaction, { updateState: false })
    } catch (error) {
      const simulationError = error instanceof Error ? error.message : String(error)
      return {
        wouldNeedRestore: false,
        intendedOperations,
        archivedKeysDetected: 0,
        archivedKeys: [],
        simulationError,
        failure: createFailureGuidance('SIMULATION_FAILED'),
      }
    }

    if (isErrorResponse(response)) {
      return {
        wouldNeedRestore: false,
        intendedOperations,
        archivedKeysDetected: 0,
        archivedKeys: [],
        simulationError: response.error,
        failure: createFailureGuidance('SIMULATION_FAILED'),
      }
    }

    if (isRestoreResponse(response)) {
      const archivedKeys = extractArchivedKeys(response)
      const minResourceFee = Number(response.minResourceFee)
      if (!Number.isSafeInteger(minResourceFee) || minResourceFee < 0) {
        return {
          wouldNeedRestore: true,
          intendedOperations,
          archivedKeysDetected: archivedKeys.length,
          archivedKeys,
          simulationError: 'Simulation returned an invalid minimum resource fee',
          failure: createFailureGuidance('SIMULATION_FAILED'),
        }
      }
      return {
        wouldNeedRestore: true,
        intendedOperations,
        archivedKeysDetected: archivedKeys.length,
        archivedKeys,
        estimatedRestoreFee: asFeeStroops(calculateRestoreFee(minResourceFee, this._config)),
      }
    }

    if (isSuccessResponse(response)) {
      return {
        wouldNeedRestore: false,
        intendedOperations,
        archivedKeysDetected: 0,
        archivedKeys: [],
      }
    }

    return {
      wouldNeedRestore: false,
      intendedOperations,
      archivedKeysDetected: 0,
      archivedKeys: [],
      simulationError: 'Simulation returned an unrecognized response',
      failure: createFailureGuidance('UNEXPECTED_SIMULATION_RESPONSE'),
    }
  }

  /**
   * Re-binds this executor to a new RPC client / config in place, keeping
   * history and the state manager intact. Used by `SorobanResurrect.switchNetwork`.
   */
  rebind(server: ISorobanRpcClient, config: Required<SorobanResurrectConfig>): void {
    this._server = server
    this._config = config
  }

  // ---------------------------------------------------------------------------
  // History accessors
  // ---------------------------------------------------------------------------

  /**
   * All recorded history entries in insertion order.
   * Each `submitWithRestore` call appends one entry.
   */
  get history(): TransactionHistoryEntry[] {
    return this._history.getAll()
  }

  /** Returns all recorded history entries in insertion order. */
  getHistory(): TransactionHistoryEntry[] {
    return this._history.getAll()
  }

  /** Clears all recorded history entries. */
  clearHistory(): void {
    this._history.clear()
  }

  // ---------------------------------------------------------------------------
  // Core execution methods
  // ---------------------------------------------------------------------------

  /**
   * Builds an unsigned restore transaction for the given source account.
   *
   * Uses `simulationResponse` directly when provided (avoids an extra RPC
   * call and state side-effects). Otherwise simulates the transaction first.
   *
   * @param sourcePublicKey     - Public key of the account that will sign/pay.
   * @param transaction         - The transaction needing restore.
   * @param simulationResponse  - Optional pre-computed restore simulation response.
   * @returns An unsigned restore `Transaction` ready to be signed.
   * @throws {Error} If the simulation response does not indicate a restore is needed.
   */
  async buildRestoreTx(
    sourcePublicKey: string,
    transaction: Transaction,
    simulationResponse?: rpc.Api.SimulateTransactionRestoreResponse,
    options: AbortSignalOptions = {},
  ): Promise<Transaction> {
    const response =
      simulationResponse ?? (await this._simulator.simulate(transaction, options))

    if (!isRestoreResponse(response)) {
      throw new Error('No archived keys detected — restore transaction not needed')
    }

    return buildRestoreTransaction({
      server: this._server,
      sourcePublicKey,
      transactionData: response.transactionData.build(),
      minResourceFee: parseInt(response.minResourceFee, 10),
      latestLedger: response.latestLedger,
      config: this._config,
      signal: options.signal,
    })
  }

  /**
   * Restores an arbitrary list of ledger keys, without requiring a source
   * transaction's simulated footprint. Builds a `restoreFootprint`
   * transaction over exactly the given keys, signs it with the wallet,
   * submits it, and polls to confirmation — reusing the same state machine
   * transitions and history recording as `submitWithRestore`.
   *
   * Useful for proactive maintenance (e.g. restoring a contract's data
   * ahead of an upgrade) where there is no transaction to simulate yet.
   *
   * @param keys    - The ledger keys to restore.
   * @param wallet  - Wallet adapter used for signing.
   * @param opts    - Optional lifecycle callbacks.
   * @returns {@link ResurrectResult} with `restoreTxHash` set on success.
   *   This method never throws — failures are returned as
   *   `ResurrectResult { success: false, error: ... }`.
   */
  async restoreKeys(
    keys: xdr.LedgerKey[],
    wallet: WalletAdapter,
    opts: RestoreKeysOptions & AbortSignalOptions = {},
  ): Promise<ResurrectResult> {
    assertBatchSize(keys.length, this._config.maxBatchSize, 'restoreKeys')
    const stateMgr = this._stateMgr
    const emitter = stateMgr.emitter
    const { signal } = opts
    let historyId: HistoryEntryId | undefined
    let restoreHash: TxHash | undefined

    try {
      throwIfAborted(signal)
      if (keys.length === 0) {
        throw new Error('restoreKeys: at least one ledger key is required')
      }

      const isConnected = await runWithSignal(() => wallet.isConnected(), signal)
      if (!isConnected) {
        throw new Error('Wallet is not connected')
      }

      const publicKey = await runWithSignal(() => wallet.getPublicKey(), signal)
      const networkPassphrase = this._config.networkPassphrase

      const restoreTx = await runWithSignal(
        () =>
          buildRestoreTransactionFromKeys({
            server: this._server,
            sourcePublicKey: publicKey,
            keys,
            config: this._config,
            signal,
          }),
        signal,
      )

      historyId = this._history.add(restoreTx)

      stateMgr.setState('signing_restore', 'Awaiting wallet signature for restore transaction...')
      opts?.onSigningRestore?.()
      const walletOptions = signal ? { networkPassphrase, signal } : { networkPassphrase }
      const signedXdr = await runWithSignal(
        () => wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), walletOptions),
        signal,
      )

      const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
      if (!(signedTx instanceof Transaction)) {
        throw new Error('Failed to parse signed restore transaction')
      }

      await assertRestoreTransactionFresh(this._server, signedTx, restoreTx)

      stateMgr.setState('submitting_restore', 'Submitting restore transaction...')
      opts?.onSubmittingRestore?.()
      const sendResult = await runWithSignal(
        () => this._server.sendTransaction(signedTx),
        signal,
      )
      restoreHash = asTxHash(sendResult.hash)
      emitter.emit('restoreSubmitted', restoreHash)
      opts?.onRestoreSubmitted?.(restoreHash)

      stateMgr.setState('confirming_restore', 'Waiting for restore confirmation...')
      const status = this._config.useSSE
        ? await waitForTransactionSSE(
            this._server,
            restoreHash,
            this._config.pollTimeoutMs,
            this._config.rpcUrl,
            { signal },
          )
        : await waitForTransaction(
            this._server,
            restoreHash,
            this._config.pollIntervalMs,
            this._config.pollTimeoutMs,
            { signal },
          )

      if (status.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error('Restore transaction failed')
      }

      emitter.emit('restoreConfirmed', restoreHash)
      opts?.onRestoreConfirmed?.(restoreHash)
      stateMgr.setState('success', 'Restore transaction confirmed')

      const result: ResurrectResult = {
        success: true,
        restoreTxHash: restoreHash,
        archivedKeysDetected: keys.length,
        historyId,
      }
      this._history.update(historyId, result)
      emitter.emit('restoreComplete', result)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stateMgr.setError(message)
      emitter.emit('error', message)
      const result: ResurrectResult = {
        success: false,
        archivedKeysDetected: keys.length,
        restoreTxHash: restoreHash,
        error: message,
        ...(err instanceof ResurrectError ? { errorCode: err.code } : {}),
        historyId,
        errorCode: signal?.aborted ? 'ABORTED' : 'UNKNOWN_ERROR',
      }
      if (historyId) {
        this._history.update(historyId, result)
      }
      return result
    }
  }

  /**
   * Signs and submits a transaction directly without automatic archive
   * restoration. Use `submitWithRestore` when restoration may be needed.
   *
   * @param transaction - The transaction to sign and submit.
   * @param wallet      - Wallet adapter used for signing.
   * @returns Result with transaction hash on success.
   */
  async sendTransaction(
    transaction: Transaction,
    wallet: WalletAdapter,
    options: AbortSignalOptions = {},
  ): Promise<ResurrectResult> {
    return _sendTransaction(this._server, transaction, wallet, this._config, options)
  }

  /**
   * Restores an arbitrary list of ledger keys, with no source transaction
   * required. See {@link restoreKeys} in `Executor.ts` for the full
   * behavior — this is a thin pass-through binding this instance's server
   * and config.
   *
   * @param keys   - Ledger keys to restore.
   * @param wallet - Wallet adapter used for signing.
   * @returns {@link ResurrectResult}; never throws.
   */
  /**
   * Submits a transaction with automatic archive restoration.
   *
   * Records the attempt in history and returns a `historyId` in the result
   * that can be passed to `retry()` to re-attempt without rebuilding the
   * transaction.
   *
   * State transitions, typed events, and caller callbacks are all fired in
   * the expected order. This method never throws — all failures are returned
   * as `ResurrectResult { success: false, error: ... }`.
   *
   * @param options - See {@link SubmitWithRestoreRequestOptions}.
   * @returns {@link ResurrectResult} with outcome, hashes, and `historyId`.
   */
  async submitWithRestore(
    options: SubmitWithRestoreOptions & AbortSignalOptions,
  ): Promise<ResurrectResult> {
    const {
      transaction,
      wallet,
      onRestoreNeeded,
      onSigningRestore,
      onSubmittingRestore,
      onRestoreSubmitted,
      onRestoreConfirmed,
      onSigningOriginal,
      onOriginalSubmitted,
      onRestoreFailed,
    } = options

    if (options.dryRun) {
      const dryRunResult = await this.previewRestore(transaction)
      const simulationError = dryRunResult.simulationError
      return {
        success: simulationError === undefined,
        dryRun: true,
        dryRunResult,
        archivedKeysDetected: dryRunResult.archivedKeysDetected,
        ...(simulationError
          ? {
              error: simulationError,
              errorCode: dryRunResult.failure?.code ?? 'SIMULATION_FAILED',
              failure: dryRunResult.failure ?? createFailureGuidance('SIMULATION_FAILED'),
            }
          : {}),
      }
    }

    const historyId = this._history.add(transaction)
    const stateMgr = this._stateMgr
    const emitter = stateMgr.emitter
    const emitLifecycle = (event: SubmitLifecycleEvent): void => {
      const payload = { ...event, requestId: event.requestId ?? options.requestId }
      emitter.emit('workflowLifecycle', payload)
      options.onLifecycleEvent?.(payload)
    }

    // Per-call restore-tx memo override (falls back to instance config).
    const effectiveConfig = {
      ...this._config,
      ...(options.restoreTxMemo !== undefined || options.restoreTxMemoText !== undefined
        ? {
            restoreTxMemo: options.restoreTxMemo,
            restoreTxMemoText: options.restoreTxMemoText,
          }
        : {}),
    }

    const restoreConfig = configForWalletRestore(effectiveConfig, wallet)
    validateRestoreMemoConfig(restoreConfig)

    const historyId = this._history.add(transaction)
    const stateMgr = this._stateMgr
    const emitter = stateMgr.emitter

    const result = await executeWithRestore({
      server: options.retry ? new RetryingRpcClient(this._server, options.retry) : this._server,
      transaction,
      wallet,
      config: effectiveConfig,
      signal: options.signal,

      onSigningRestore: () => {
        stateMgr.setState('signing_restore', 'Awaiting wallet signature for restore transaction...')
        onSigningRestore?.()
      },

      onSubmittingRestore: () => {
        stateMgr.setState('submitting_restore', 'Submitting restore transaction...')
        onSubmittingRestore?.()
      },

      onRestoreNeeded: (keys: ArchivedLedgerEntry[]) => {
        stateMgr.setArchivedKeys(keys)
        stateMgr.setState('restore_needed', `Detected ${keys.length} archived ledger entries`)
        emitter.emit('restoreNeeded', keys)
        onRestoreNeeded?.(keys)
      },

      onRestoreSubmitted: (txHash: TxHash) => {
        stateMgr.setState('confirming_restore', 'Waiting for restore confirmation...')
        emitter.emit('restoreSubmitted', asTxHash(txHash))
        onRestoreSubmitted?.(asTxHash(txHash))
      },

      onRestoreConfirmed: (txHash: string) => {
        stateMgr.setState(
          'submitting_original',
          'Restore confirmed. Preparing original transaction...',
        )
        emitter.emit('restoreConfirmed', asTxHash(txHash))
        onRestoreConfirmed?.(asTxHash(txHash))
      },

      onSigningOriginal: () => {
        stateMgr.setState('signing_original', 'Signing original transaction...')
        onSigningOriginal?.()
      },

      onOriginalSubmitted: (txHash: TxHash) => {
        emitter.emit('originalSubmitted', asTxHash(txHash))
        onOriginalSubmitted?.(asTxHash(txHash))
      },

      onRestoreFailed: (error: string) => {
        stateMgr.setError(error)
        emitter.emit('error', error)
        onRestoreFailed?.(error)
      },

      onSigningFeeBump: () => {
        stateMgr.setState('signing_restore', 'Awaiting sponsor signature for fee-bump...')
      },
    })

    const finalResult = { ...result, historyId }
    this._history.update(historyId, finalResult)

    if (!finalResult.success) {
      stateMgr.setError(finalResult.error ?? 'Unknown error')
      emitter.emit('error', finalResult.error ?? 'Unknown error')
    } else {
      const message =
        finalResult.confirmationStatus === 'submitted'
          ? 'Original transaction submitted successfully'
          : 'Original transaction confirmed successfully'
      stateMgr.setState('success', message)
    }

    emitLifecycle({
      phase: finalResult.success ? 'completed' : 'failed',
      result: finalResult,
      error: finalResult.error,
    })
    emitter.emit('restoreComplete', finalResult)

    return finalResult
  }

  /**
   * Retries a previously recorded workflow by its history entry id.
   *
   * Retrieves the original transaction from history, increments the attempt
   * counter, and re-runs the full `executeWithRestore` flow. The history
   * entry is updated with the new result.
   *
   * @param entryId - The `historyId` returned by a prior `submitWithRestore`.
   * @param wallet  - Wallet adapter to use for signing.
   * @returns Result of the retry attempt.
   * @throws {Error} If no history entry exists for `entryId`.
   */
  async retry(
    entryId: string,
    wallet: WalletAdapter,
    options: AbortSignalOptions = {},
  ): Promise<ResurrectResult> {
    const id = asHistoryEntryId(entryId)
    const entry = this._history.get(id)
    if (!entry) {
      throw new Error(`No history entry found for id: ${entryId}`)
    }

    this._history.incrementAttempt(id)

    const stateMgr = this._stateMgr

    const result = await executeWithRestore({
      server: this._server,
      transaction: entry.transaction,
      wallet,
      config: this._config,
      signal: options.signal,

      onSigningRestore: () => {
        stateMgr.setState('signing_restore', 'Awaiting wallet signature for restore transaction...')
      },
      onSubmittingRestore: () => {
        stateMgr.setState('submitting_restore', 'Submitting restore transaction...')
      },
      onRestoreNeeded: (keys: ArchivedLedgerEntry[]) => {
        stateMgr.setArchivedKeys(keys)
        stateMgr.setState('restore_needed', `Detected ${keys.length} archived ledger entries`)
      },
      onRestoreSubmitted: (_txHash: string) => {
        stateMgr.setState('confirming_restore', 'Waiting for restore confirmation...')
      },
      onRestoreConfirmed: (_txHash: string) => {
        stateMgr.setState(
          'submitting_original',
          'Restore confirmed. Preparing original transaction...',
        )
      },
      onSigningOriginal: () => {
        stateMgr.setState('signing_original', 'Signing original transaction...')
      },
    })

    this._history.update(id, result)

    if (!result.success) {
      stateMgr.setError(result.error ?? 'Unknown error')
    } else {
      stateMgr.setState(
        'success',
        result.confirmationStatus === 'submitted'
          ? 'Original transaction submitted successfully'
          : 'Original transaction confirmed successfully',
      )
    }

    return result
  }

  /**
   * Builds a single unsigned restore transaction covering the union of
   * archived keys detected across every transaction in `transactions`.
   *
   * @param sourcePublicKey - Public key of the account that will sign/pay.
   * @param transactions    - Transactions to inspect for archived keys.
   * @returns An unsigned restore `Transaction`, or `null` if none of the
   *   given transactions need restoring.
   */
  async buildBatchRestoreTx(
    sourcePublicKey: string,
    transactions: Transaction[],
    options: AbortSignalOptions = {},
  ): Promise<Transaction | null> {
    const { restoreTx } = await runWithSignal(
      () =>
        buildBatchRestoreTransaction({
          server: this._server,
          sourcePublicKey,
          transactions,
          config: this._config,
          signal: options.signal,
        }),
      options.signal,
    )
    return restoreTx
  }

  /**
   * Submits multiple transactions with automatic archive restoration.
   *
   * When two or more transactions need restoring, a single batch restore
   * transaction (see {@link buildBatchRestoreTx}) covers the union of their
   * archived keys — one restore fee instead of N. Once it confirms, every
   * original transaction is resubmitted sequentially: each is rebuilt via
   * `buildOriginalAfterRestore`, which fetches the account's current
   * sequence number immediately before building, so back-to-back
   * submissions never race on sequence numbers. Every returned result
   * carries the same `restoreTxHash`.
   *
   * When none of the transactions need restoring, this falls back to
   * plain sequential `submitWithRestore` calls (equivalent to direct
   * submission, since there's nothing to share).
   *
   * A failure on one transaction does not stop processing of the remaining
   * ones once past the shared restore step; if the shared restore itself
   * fails, every item in the batch fails with that error.
   *
   * @param items - Array of request options, one per transaction.
   *   All items must share the same source account (the restore transaction
   *   is built and paid for by `items[0].wallet`).
   * @returns Array of results in the same order as the input.
   */
  async submitBatchWithRestore(
    items: SubmitWithRestoreOptions[],
    options: AbortSignalOptions = {},
  ): Promise<ResurrectResult[]> {
    if (items.length === 0) return []
    if (items.length === 1) {
      return [await this.submitWithRestore({ ...items[0], signal: options.signal })]
    }

    const restoreConfigs = items.map((item) => {
      const hasMemoOverride =
        item.restoreTxMemo !== undefined || item.restoreTxMemoText !== undefined
      const config = hasMemoOverride
        ? {
            ...this._config,
            restoreTxMemo: item.restoreTxMemo,
            restoreTxMemoText: item.restoreTxMemoText,
          }
        : this._config
      validateRestoreMemoConfig(config)
      return config
    })

    if (
      items.some(
        (item) =>
          item.configOverrides !== undefined ||
          item.restoreTxMemo !== undefined ||
          item.restoreTxMemoText !== undefined,
      )
    ) {
      const results: ResurrectResult[] = []
      for (const item of items) {
        results.push(await this.submitWithRestore(item))
      }
      return results
    }

    const wallet = items[0].wallet
    const { signal: sharedSignal } = options
    const transactions = items.map((item) => item.transaction)

    let publicKey: string
    let restoreTx: Transaction | null
    let archivedKeysByTx: ArchivedLedgerEntry[][]
    try {
      const isConnected = await runWithSignal(() => wallet.isConnected(), sharedSignal)
      if (!isConnected) {
        const error = 'Wallet is not connected'
        return items.map(() => ({ success: false, archivedKeysDetected: 0, error }))
      }
      publicKey = await runWithSignal(() => wallet.getPublicKey(), sharedSignal)

      const batch = await runWithSignal(
        () =>
          buildBatchRestoreTransaction({
            server: this._server,
            sourcePublicKey: publicKey,
            transactions,
            config: this._config,
            signal: sharedSignal,
          }),
        sharedSignal,
      )
      restoreTx = batch.restoreTx
      archivedKeysByTx = batch.archivedKeysByTx
    } catch (err) {
      if (!sharedSignal?.aborted) throw err
      const error = err instanceof Error ? err.message : String(err)
      this._stateMgr.setError(error)
      this._stateMgr.emitter.emit('error', error)
      return items.map(() => ({
        success: false,
        archivedKeysDetected: 0,
        error,
        errorCode: 'ABORTED',
      }))
    }

    if (!restoreTx) {
      // Nothing archived across the batch — no shared restore needed.
      const results: ResurrectResult[] = []
      for (const item of items) {
        results.push(await this.submitWithRestore({ ...item, signal: sharedSignal }))
      }
      return results
    }
    const memoSignature = (config: (typeof restoreConfigs)[number]): string => {
      const memo = resolveRestoreMemo(undefined, config)
      return JSON.stringify(memo ? [memo.type, memo.value] : ['none'])
    }
    if (restoreConfigs.some((config) => memoSignature(config) !== memoSignature(restoreConfigs[0]))) {
      throw new ResurrectError(
        'INVALID_RESTORE_MEMO',
        'submitBatchWithRestore builds one shared restore transaction; all items must use the same restore memo configuration.',
      )
    }

    const networkPassphrase = this._config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
    const pollInterval = this._config.pollIntervalMs ?? POLL_INTERVAL_MS
    const pollTimeout = this._config.pollTimeoutMs ?? POLL_TIMEOUT_MS
    const stateMgr = this._stateMgr
    const emitter = stateMgr.emitter

    let restoreHash: TxHash | undefined
    try {
      stateMgr.setArchivedKeys(archivedKeysByTx.flat())
      stateMgr.setState(
        'restore_needed',
        `Detected archived entries across ${archivedKeysByTx.filter((k) => k.length > 0).length} of ${items.length} transactions`,
      )
      emitter.emit('restoreNeeded', archivedKeysByTx.flat())

      stateMgr.setState(
        'signing_restore',
        'Awaiting wallet signature for batch restore transaction...',
      )
      const walletOptions = sharedSignal
        ? { networkPassphrase, signal: sharedSignal }
        : { networkPassphrase }
      const signedXdr = await runWithSignal(
        () => wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), walletOptions),
        sharedSignal,
      )
      const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
      if (!(signedTx instanceof Transaction)) {
        throw new Error('Failed to parse signed batch restore transaction')
      }

      await assertRestoreTransactionFresh(this._server, signedTx, restoreTx)

      stateMgr.setState('submitting_restore', 'Submitting batch restore transaction...')
      const sent = await runWithSignal(() => this._server.sendTransaction(signedTx), sharedSignal)
      restoreHash = asTxHash(sent.hash)
      emitter.emit('restoreSubmitted', restoreHash)

      stateMgr.setState('confirming_restore', 'Waiting for batch restore confirmation...')
      const status = await waitForTransaction(
        this._server,
        restoreHash,
        pollInterval,
        pollTimeout,
        { signal: sharedSignal },
      )
      if (status.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error('Batch restore transaction failed')
      }
      emitter.emit('restoreConfirmed', restoreHash)
      stateMgr.setState(
        'submitting_original',
        'Batch restore confirmed. Submitting original transactions...',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stateMgr.setError(message)
      emitter.emit('error', message)
      return items.map((_, i) => ({
        success: false,
        restoreTxHash,
        archivedKeysDetected: archivedKeysByTx[i]?.length ?? 0,
        error: message,
        errorCode: sharedSignal?.aborted ? 'ABORTED' : 'UNKNOWN_ERROR',
      }))
    }

    const results: ResurrectResult[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const { signal } = options
      try {
        const preparedTx = await runWithSignal(
          () =>
            buildOriginalAfterRestore(
              this._server,
              item.transaction,
              networkPassphrase,
              item.transaction.fee,
              signal,
            ),
          signal,
        )
        item.onSigningOriginal?.()
        const walletOptions = signal ? { networkPassphrase, signal } : { networkPassphrase }
        const signedXdr = await runWithSignal(
          () => item.wallet.signTransaction(asXdrBase64(preparedTx.toXDR()), walletOptions),
          signal,
        )
        const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
        if (!(signedTx instanceof Transaction)) {
          throw new Error('Failed to parse signed transaction')
        }

        const sent = await runWithSignal(() => this._server.sendTransaction(signedTx), signal)
        const hash = asTxHash(sent.hash)
        item.onOriginalSubmitted?.(hash)
        emitter.emit('originalSubmitted', hash)

        results.push({
          success: true,
          originalTxHash: hash,
          restoreTxHash: restoreHash,
          archivedKeysDetected,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        stateMgr.setError(message)
        item.onRestoreFailed?.(message)
        emitter.emit('error', message)
        if (err instanceof OriginalTransactionExpiredError) {
          results.push({
            success: false,
            restoreTxHash: restoreHash,
            archivedKeysDetected,
            error: message,
            errorCode: err.code,
            failure: createFailureGuidance(err.code, 'rebuild'),
            expiredTransaction: err.expiredTransaction,
          })
          continue
        }
        if (err instanceof ResurrectError) {
          results.push({
            success: false,
            restoreTxHash: restoreHash,
            archivedKeysDetected,
            error: message,
            errorCode: err.code,
            failure: createFailureGuidance(err.code, 'rebuild'),
          })
          continue
        }
        results.push({
          success: false,
          restoreTxHash: restoreHash,
          archivedKeysDetected,
          error: message,
          errorCode: signal?.aborted ? 'ABORTED' : 'UNKNOWN_ERROR',
        })
      }
    }

    if (results.every((result) => result.success)) {
      stateMgr.setState('success', 'Batch submission complete')
    }
    return results
  }
}
