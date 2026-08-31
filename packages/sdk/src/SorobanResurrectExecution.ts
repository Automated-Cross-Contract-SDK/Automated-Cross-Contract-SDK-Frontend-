import { rpc, Transaction, TransactionBuilder } from '@stellar/stellar-sdk'
import {
  ArchivedLedgerEntry,
  ResurrectResult,
  RestoreKeysOptions,
  SubmitWithRestoreOptions,
  WalletAdapter,
} from './types.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import { executeWithRestore, sendTransaction as _sendTransaction } from './Executor.js'
import {
  buildRestoreTransaction,
  buildBatchRestoreTransaction,
  buildOriginalAfterRestore,
  waitForTransaction,
} from './Restorer.js'
import { isRestoreResponse } from './Archiver.js'
import { TransactionHistory, TransactionHistoryEntry } from './TransactionHistory.js'
import { attachHistoryPersistence, type HistoryPersistenceHandle } from './HistoryPersistence.js'
import type { HistoryPersistenceOptions } from './types.js'
import { SorobanResurrectStateManager } from './SorobanResurrectState.js'
import { SorobanResurrectSimulator } from './SorobanResurrectSimulation.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import { asTxHash, asHistoryEntryId } from './branded-types.js'

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
      ? attachHistoryPersistence(this._history, persistHistory.storage, persistHistory.key)
      : null
  }

  /**
   * Resolves once transaction history has been hydrated from durable storage.
   * When persistence is disabled this resolves immediately.
   */
  get historyHydrated(): Promise<void> {
    return this._historyPersistence?.hydrated ?? Promise.resolve()
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
  ): Promise<Transaction> {
    const response = simulationResponse ?? (await this._simulator.simulate(transaction))

    if (!isRestoreResponse(response)) {
      throw new Error('No archived keys detected — restore transaction not needed')
    }

    return buildRestoreTransaction({
      server: this._server,
      sourcePublicKey,
      transactionData: response.transactionData.build(),
      minResourceFee: parseInt(response.minResourceFee, 10),
      config: this._config,
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
    opts?: RestoreKeysOptions,
  ): Promise<ResurrectResult> {
    const stateMgr = this._stateMgr
    const emitter = stateMgr.emitter
    let historyId: HistoryEntryId | undefined

    try {
      if (keys.length === 0) {
        throw new Error('restoreKeys: at least one ledger key is required')
      }

      const isConnected = await wallet.isConnected()
      if (!isConnected) {
        throw new Error('Wallet is not connected')
      }

      const publicKey = await wallet.getPublicKey()
      const networkPassphrase = this._config.networkPassphrase

      const restoreTx = await buildRestoreTransactionFromKeys({
        server: this._server,
        sourcePublicKey: publicKey,
        keys,
        config: this._config,
      })

      historyId = this._history.add(restoreTx)

      stateMgr.setState('signing_restore', 'Awaiting wallet signature for restore transaction...')
      opts?.onSigningRestore?.()
      const signedXdr = await wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), {
        networkPassphrase,
      })

      const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
      if (!(signedTx instanceof Transaction)) {
        throw new Error('Failed to parse signed restore transaction')
      }

      stateMgr.setState('submitting_restore', 'Submitting restore transaction...')
      opts?.onSubmittingRestore?.()
      const sendResult = await this._server.sendTransaction(signedTx)
      const restoreHash = asTxHash(sendResult.hash)
      emitter.emit('restoreSubmitted', restoreHash)
      opts?.onRestoreSubmitted?.(restoreHash)

      stateMgr.setState('confirming_restore', 'Waiting for restore confirmation...')
      const status = this._config.useSSE
        ? await waitForTransactionSSE(this._server, restoreHash, this._config.pollTimeoutMs)
        : await waitForTransaction(
            this._server,
            restoreHash,
            this._config.pollIntervalMs,
            this._config.pollTimeoutMs,
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
        error: message,
        historyId,
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
  async sendTransaction(transaction: Transaction, wallet: WalletAdapter): Promise<ResurrectResult> {
    return _sendTransaction(this._server, transaction, wallet, this._config)
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
  async restoreKeys(keys: xdr.LedgerKey[], wallet: WalletAdapter): Promise<ResurrectResult> {
    return _restoreKeys({ server: this._server, keys, wallet, config: this._config })
  }

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
   * @param options - See {@link SubmitWithRestoreOptions}.
   * @returns {@link ResurrectResult} with outcome, hashes, and `historyId`.
   */
  async submitWithRestore(options: SubmitWithRestoreOptions): Promise<ResurrectResult> {
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

    const historyId = this._history.add(transaction)
    const stateMgr = this._stateMgr
    const emitter = stateMgr.emitter

    // Per-call restore-tx memo override (falls back to instance config).
    const effectiveConfig =
      options.restoreTxMemo !== undefined || options.restoreTxMemoText !== undefined
        ? {
            ...this._config,
            restoreTxMemo: options.restoreTxMemo ?? this._config.restoreTxMemo,
            restoreTxMemoText: options.restoreTxMemoText ?? this._config.restoreTxMemoText,
          }
        : this._config

    const result = await executeWithRestore({
      server: this._server,
      transaction,
      wallet,
      config: effectiveConfig,

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
        stateMgr.setState('submitting_original', 'Restore confirmed. Preparing original transaction...')
        emitter.emit('restoreConfirmed', asTxHash(txHash))
        onRestoreConfirmed?.(asTxHash(txHash))
      },

      onSigningOriginal: () => {
        stateMgr.setState('signing_original', 'Signing original transaction...')
        onSigningOriginal?.()
      },

      onOriginalSubmitted: (txHash: TxHash) => {
        stateMgr.setState('success', 'Original transaction submitted successfully')
        emitter.emit('originalSubmitted', asTxHash(txHash))
        onOriginalSubmitted?.(asTxHash(txHash))
      },

      onRestoreFailed: (error: string) => {
        emitter.emit('error', error)
        onRestoreFailed?.(error)
      },

      onSigningFeeBump: () => {
        stateMgr.setState('signing_restore', 'Awaiting sponsor signature for fee-bump...')
      },
    })

    this._history.update(historyId, result)

    if (!result.success) {
      stateMgr.setError(result.error ?? 'Unknown error')
      emitter.emit('error', result.error ?? 'Unknown error')
    }

    emitter.emit('restoreComplete', result)

    return { ...result, historyId }
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
  async retry(entryId: string, wallet: WalletAdapter): Promise<ResurrectResult> {
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
      onOriginalSubmitted: (_txHash: string) => {
        stateMgr.setState('success', 'Original transaction submitted successfully')
      },
    })

    this._history.update(id, result)

    if (!result.success) {
      stateMgr.setError(result.error ?? 'Unknown error')
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
  ): Promise<Transaction | null> {
    const { restoreTx } = await buildBatchRestoreTransaction({
      server: this._server,
      sourcePublicKey,
      transactions,
      config: this._config,
    })
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
   * @param items - Array of `SubmitWithRestoreOptions`, one per transaction.
   *   All items must share the same source account (the restore transaction
   *   is built and paid for by `items[0].wallet`).
   * @returns Array of results in the same order as the input.
   */
  async submitBatchWithRestore(items: SubmitWithRestoreOptions[]): Promise<ResurrectResult[]> {
    if (items.length === 0) return []
    if (items.length === 1) return [await this.submitWithRestore(items[0])]

    const wallet = items[0].wallet
    const transactions = items.map((item) => item.transaction)

    const isConnected = await wallet.isConnected()
    if (!isConnected) {
      const error = 'Wallet is not connected'
      return items.map(() => ({ success: false, archivedKeysDetected: 0, error }))
    }
    const publicKey = await wallet.getPublicKey()

    const { restoreTx, archivedKeysByTx } = await buildBatchRestoreTransaction({
      server: this._server,
      sourcePublicKey: publicKey,
      transactions,
      config: this._config,
    })

    if (!restoreTx) {
      // Nothing archived across the batch — no shared restore needed.
      const results: ResurrectResult[] = []
      for (const item of items) {
        results.push(await this.submitWithRestore(item))
      }
      return results
    }

    const networkPassphrase = this._config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
    const pollInterval = this._config.pollIntervalMs ?? POLL_INTERVAL_MS
    const pollTimeout = this._config.pollTimeoutMs ?? POLL_TIMEOUT_MS
    const stateMgr = this._stateMgr
    const emitter = stateMgr.emitter

    let restoreHash: TxHash
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
      const signedXdr = await wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), {
        networkPassphrase,
      })
      const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
      if (!(signedTx instanceof Transaction)) {
        throw new Error('Failed to parse signed batch restore transaction')
      }

      stateMgr.setState('submitting_restore', 'Submitting batch restore transaction...')
      const sent = await this._server.sendTransaction(signedTx)
      restoreHash = asTxHash(sent.hash)
      emitter.emit('restoreSubmitted', restoreHash)

      stateMgr.setState('confirming_restore', 'Waiting for batch restore confirmation...')
      const status = await waitForTransaction(this._server, restoreHash, pollInterval, pollTimeout)
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
        archivedKeysDetected: archivedKeysByTx[i]?.length ?? 0,
        error: message,
      }))
    }

    const results: ResurrectResult[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      try {
        const preparedTx = await buildOriginalAfterRestore(
          this._server,
          item.transaction,
          networkPassphrase,
          item.transaction.fee,
        )
        item.onSigningOriginal?.()
        const signedXdr = await item.wallet.signTransaction(asXdrBase64(preparedTx.toXDR()), {
          networkPassphrase,
        })
        const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
        if (!(signedTx instanceof Transaction)) {
          throw new Error('Failed to parse signed transaction')
        }

        const sent = await this._server.sendTransaction(signedTx)
        const hash = asTxHash(sent.hash)
        item.onOriginalSubmitted?.(hash)
        emitter.emit('originalSubmitted', hash)

        results.push({
          success: true,
          originalTxHash: hash,
          restoreTxHash: restoreHash,
          archivedKeysDetected: archivedKeysByTx[i]?.length ?? 0,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        item.onRestoreFailed?.(message)
        emitter.emit('error', message)
        results.push({
          success: false,
          restoreTxHash: restoreHash,
          archivedKeysDetected: archivedKeysByTx[i]?.length ?? 0,
          error: message,
        })
      }
    }

    stateMgr.setState('success', 'Batch submission complete')
    return results
  }
}
