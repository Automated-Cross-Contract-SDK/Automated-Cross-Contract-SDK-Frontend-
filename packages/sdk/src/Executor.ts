import {
  rpc,
  TransactionBuilder,
  Transaction,
  Operation,
  SorobanDataBuilder,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from './RpcClient.js'
import {
  type SorobanResurrectConfig,
  type WalletAdapter,
  type FeeBumpConfig,
  type ArchivedLedgerEntry,
  type ResurrectResult,
  type SubmitLifecycleEvent,
  type ConfirmationPolicy,
  type ConfirmationTimeoutBehavior,
  WalletError,
  RebuildTimeBounds,
  ExpiredTransactionInfo,
} from './types.js'
import { withPhaseTimeout } from './phaseTimeout.js'
import {
  OriginalTransactionExpiredError,
  ResurrectError,
  ResurrectTimeoutError,
  RestoreFeeExceededError,
  SigningError,
  getResurrectErrorCode,
  type ResurrectErrorCode,
} from './errors.js'
import {
  isRestoreResponse,
  isSuccessResponse,
  isErrorResponse,
  extractArchivedKeys,
  extractAutoRestoredKeys,
} from './Archiver.js'
import { createDebugger } from './Debug.js'
import {
  buildRestoreTransaction,
  waitForTransaction,
  waitForTransactionSSE,
  buildOriginalAfterRestore,
  assertRestoreTransactionFresh,
  buildFeeBumpTransaction,
  submitFeeBumpTransaction,
  isTxBadSeqError,
  getExpiredTransactionInfo,
} from './Restorer.js'
import { SimulationCache } from './SimulationCache.js'
import { authorizeAndFinalize } from './Authorization.js'
import {
  DEFAULT_NETWORK_PASSPHRASE,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  MAX_SEQUENCE_RETRIES,
} from './constants.js'
import { signAndVerifyTransaction } from './signedTransaction.js'
import { assembleIfNeeded, assertSubmitted } from './submission.js'
import { asTxHash, asXdrBase64, type TxHash } from './branded-types.js'
import { parseTransactionFailure } from './TransactionFailure.js'
import { createFailureGuidance } from './FailureGuidance.js'
import { runWithSignal, throwIfAborted, type AbortSignalOptions } from './AbortUtils.js'
import { assertBatchSize } from './batchLimits.js'
import { assertWalletCapability } from './walletCapabilities.js'

/** Parameters for the full restore-and-submit execution flow. */
export interface ExecuteParams extends AbortSignalOptions {
  /** RPC client used for all Soroban network calls. */
  server: ISorobanRpcClient
  /** The original transaction to submit (may need restore first). */
  transaction: Transaction
  /** Wallet adapter used for signing. */
  wallet: WalletAdapter
  /** SDK configuration. */
  config: SorobanResurrectConfig
  /** Optional signal for cancelling this workflow before a submission stage. */
  signal?: AbortSignal
  /** Called when the wallet is prompted to sign the restore transaction. */
  onSigningRestore?: () => void
  /** Called right before the restore transaction is submitted. */
  onSubmittingRestore?: () => void
  /** Called when archived entries are detected. */
  onRestoreNeeded?: (archivedKeys: ArchivedLedgerEntry[]) => void
  /** Called after the restore transaction is submitted. */
  onRestoreSubmitted?: (txHash: TxHash) => void
  /** Called after the restore transaction is confirmed. */
  onRestoreConfirmed?: (txHash: TxHash) => void
  /** Called when the wallet is prompted to sign the original transaction. */
  onSigningOriginal?: () => void
  /** Called after the original transaction is submitted. */
  onOriginalSubmitted?: (txHash: TxHash) => void
  /** Called when the restore step of the workflow fails. */
  onRestoreFailed?: (error: string) => void
  /** Called when a fee-bump sponsor is about to sign a transaction. */
  onSigningFeeBump?: () => void
  /** Called when a lifecycle phase is reached. */
  onLifecycleEvent?: (event: SubmitLifecycleEvent) => void
  /** Optional caller correlation id attached to lifecycle events. */
  requestId?: string
  /** Optional sponsor fee-bump configuration. */
  feeBumpConfig?: FeeBumpConfig
  /** Optional cache for simulation results. */
  simulationCache?: SimulationCache
  /** Confirmation policy for the original transaction. */
  confirmationPolicy?: ConfirmationPolicy
  /** Per-request confirmation polling timeout. */
  confirmationTimeoutMs?: number
  /** Behavior when confirmation polling reaches its timeout. */
  confirmationTimeoutBehavior?: ConfirmationTimeoutBehavior
  /** Replacement time bounds for the rebuilt original transaction. */
  rebuildTimeBounds?: RebuildTimeBounds
  /** Called when the original transaction expired during restore; return new bounds to approve a rebuild. */
  approveExpiredRebuild?: (
    expiredTransaction: ExpiredTransactionInfo,
  ) => RebuildTimeBounds | undefined | Promise<RebuildTimeBounds | undefined>
}

async function validateWalletNetwork(
  wallet: WalletAdapter,
  networkPassphrase: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!wallet.getNetwork) return
  const walletNetwork = await runWithSignal(() => wallet.getNetwork!(), signal)
  if (walletNetwork !== networkPassphrase) {
    throw new WalletError(
      'NETWORK_MISMATCH',
      `Wallet network mismatch: wallet is on "${walletNetwork}", SDK is configured for "${networkPassphrase}"`,
    )
  }
}

function walletErrorMessage(error: unknown): string {
  const cause = error instanceof SigningError ? error.originalError : error
  if (cause instanceof Error && 'code' in cause && cause.code === 'USER_REJECTED') {
    return 'Signature request declined'
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Helper: simulates a transaction with optional cache.
 *
 * If a SimulationCache is provided, checks the cache first and stores
 * results on cache miss, reducing RPC calls for repeated simulations
 * of transactions that differ only by sequence number.
 */
async function simulateWithCache(
  server: ISorobanRpcClient,
  tx: Transaction,
  cache?: SimulationCache,
  signal?: AbortSignal,
): Promise<rpc.Api.SimulateTransactionResponse> {
  throwIfAborted(signal)
  if (cache) {
    const cached = cache.get(tx)
    if (cached) {
      return cached as rpc.Api.SimulateTransactionResponse
    }
    const response = await runWithSignal(() => server.simulateTransaction(tx), signal)
    cache.set(tx, response)
    return response
  }
  return runWithSignal(() => server.simulateTransaction(tx), signal)
}

/**
 * Helper: waits for a transaction using SSE if configured, otherwise polls.
 */
async function waitForTx(
  server: ISorobanRpcClient,
  hash: TxHash | string,
  config: SorobanResurrectConfig,
  signal?: AbortSignal,
): Promise<rpc.Api.GetTransactionResponse> {
  throwIfAborted(signal)
  const pollTimeout = config.pollTimeoutMs ?? POLL_TIMEOUT_MS

  if (config.useSSE) {
    return waitForTransactionSSE(server, hash, pollTimeout, config.rpcUrl, { signal })
  }

  const pollInterval = config.pollIntervalMs ?? POLL_INTERVAL_MS
  return waitForTransaction(server, hash, pollInterval, pollTimeout, { signal })
}

function isConfirmationTimeout(error: unknown): error is Error {
  return error instanceof ResurrectTimeoutError && error.code !== 'RPC_TIMEOUT'
}

/**
 * Executes the full restore-and-submit workflow:
 *
 * 1. Simulate the original transaction.
 * 2. If simulation error → return error.
 * 3. If restore needed → extract archived keys, build restore tx,
 *    sign, optionally fee-bump, submit, wait for confirmation.
 * 4. Rebuild original tx with fresh seq number, re-simulate, assemble.
 * 5. Sign, optionally fee-bump, and submit the original transaction.
 * 6. If simulation succeeds → sign, optionally fee-bump, and submit directly.
 *
 * When feeBumpConfig is provided, transactions are wrapped in fee-bump
 * envelopes so the sponsor pays the fees on behalf of the user.
 *
 * All errors (simulation, signing, network) are caught and returned as
 * structured `ResurrectResult` objects — never thrown.
 *
 * Callbacks are invoked consistently for all error paths where applicable:
 * - onRestoreFailed is called for any errors during or after restore initiation
 * - onOriginalSubmitted is only called if the original tx is successfully submitted
 * - onRestoreNeeded is called before any restore attempt
 *
 * @param params - See {@link ExecuteParams}.
 * @returns A {@link ResurrectResult} describing the outcome. `success` is
 *   `false` for every failure path; this function itself does not throw.
 * @see {@link SorobanResurrect.submitWithRestore} — the public, stateful
 *   wrapper around this function used by SDK consumers.
 */
const debug = createDebugger('executor')

/** Runs `operation` (which honours the abort signal itself), bounded by `timeoutMs` when one is configured. */
function bounded<T>(
  operation: () => Promise<T>,
  timeoutMs: number | undefined,
  phase: string,
): Promise<T> {
  return withPhaseTimeout(operation(), timeoutMs, phase)
}

export async function executeWithRestore(params: ExecuteParams): Promise<ResurrectResult> {
  const { server, transaction: originalTx, wallet, config, signal, requestId } = params
  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
  const pollInterval = config.pollIntervalMs ?? POLL_INTERVAL_MS
  const confirmationConfig =
    params.confirmationTimeoutMs === undefined
      ? config
      : { ...config, pollTimeoutMs: params.confirmationTimeoutMs }

  // Everything known so far; merged into whichever result is returned.
  const progress: Pick<
    ResurrectResult,
    'archivedKeysDetected' | 'restoreMode' | 'restoreTxHash' | 'originalTxHash' | 'sequenceRetries'
  > = { archivedKeysDetected: 0 }

  const emit = (phase: SubmitLifecycleEvent['phase'], details?: Partial<SubmitLifecycleEvent>) =>
    params.onLifecycleEvent?.({ phase, requestId, ...details })

  const fail = (
    errorCode: ResurrectErrorCode,
    error: string,
    details: Partial<ResurrectResult> = {},
    stage?: Parameters<typeof createFailureGuidance>[1],
  ): ResurrectResult => {
    params.onRestoreFailed?.(error)
    return {
      success: false,
      ...progress,
      error,
      errorCode,
      failure: createFailureGuidance(errorCode, stage),
      ...details,
    }
  }

  const sign = (transaction: Transaction) =>
    bounded(
      () => signAndVerifyTransaction(transaction, wallet, networkPassphrase, config, signal),
      config.walletSigningTimeoutMs,
      'Wallet signing',
    )

  /** Submits a signed transaction, wrapped in the sponsor's fee bump when configured. */
  const send = async (signed: Transaction): Promise<rpc.Api.SendTransactionResponse> => {
    throwIfAborted(signal)
    const { feeBumpConfig } = params
    if (!feeBumpConfig) return runWithSignal(() => server.sendTransaction(signed), signal)
    params.onSigningFeeBump?.()
    const feeBump = await runWithSignal(
      () =>
        buildFeeBumpTransaction(
          asXdrBase64(signed.toXDR()),
          feeBumpConfig.sponsor,
          networkPassphrase,
          feeBumpConfig.feeBumpFee,
        ),
      signal,
    )
    throwIfAborted(signal)
    return runWithSignal(() => submitFeeBumpTransaction(server, feeBump, networkPassphrase), signal)
  }

  const confirm = async (hash: TxHash, isRestore: boolean) =>
    isRestore
      ? bounded(
          () => waitForTx(server, hash, confirmationConfig, signal),
          config.restoreConfirmationTimeoutMs,
          'Restore confirmation',
        )
      : waitForTx(server, hash, confirmationConfig, signal)

  /** Submits nothing: confirms an already-submitted original transaction. */
  const finishOriginal = async (hash: TxHash): Promise<ResurrectResult> => {
    progress.originalTxHash = hash
    params.onOriginalSubmitted?.(hash)
    emit('original_submitted', { transactionHash: hash })
    if (params.confirmationPolicy === 'return-on-submission') {
      return { success: true, ...progress, confirmationStatus: 'submitted' }
    }

    emit('original_confirmation_started', { transactionHash: hash })
    const status = await confirm(hash, false)
    if (status.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      return fail(
        'ORIGINAL_TX_FAILED',
        'Original transaction failed to confirm',
        { onchainError: parseTransactionFailure(status) },
        'confirmation',
      )
    }
    emit('original_confirmed', { transactionHash: hash })
    return { success: true, ...progress }
  }

  const restoreThenSubmit = async (
    simulation: rpc.Api.SimulateTransactionRestoreResponse,
  ): Promise<ResurrectResult> => {
    const archivedKeys = extractArchivedKeys(simulation)
    progress.archivedKeysDetected = archivedKeys.length
    progress.restoreMode = 'separate'
    debug('executeWithRestore: restore required for %d entries', archivedKeys.length)
    emit('restore_preparation_started', { archivedKeys })

    if (!(await runWithSignal(() => wallet.isConnected(), signal))) {
      return fail('WALLET_NOT_CONNECTED', 'Wallet is not connected')
    }
    const publicKey = await runWithSignal(() => wallet.getPublicKey(), signal)
    const account = await runWithSignal(() => server.getAccount(publicKey), signal)
    const restoreTx = await buildRestoreTransaction({
      server,
      sourcePublicKey: publicKey,
      transactionData: simulation.transactionData.build(),
      minResourceFee: parseInt(simulation.minResourceFee, 10),
      latestLedger: simulation.latestLedger,
      config,
      account,
      signal,
    })

    throwIfAborted(signal)
    params.onRestoreNeeded?.(archivedKeys)
    params.onSigningRestore?.()
    const signedRestore = await sign(restoreTx)
    await assertRestoreTransactionFresh(server, signedRestore, restoreTx)

    throwIfAborted(signal)
    params.onSubmittingRestore?.()
    emit('restore_submission_started')
    const sentRestore = await send(signedRestore)
    assertSubmitted(sentRestore, 'RESTORE_TX_FAILED', 'Restore transaction')
    const restoreHash = asTxHash(sentRestore.hash)
    progress.restoreTxHash = restoreHash
    params.onRestoreSubmitted?.(restoreHash)
    emit('restore_submitted', { transactionHash: restoreHash })

    emit('restore_confirmation_started', { transactionHash: restoreHash })
    const restoreStatus = await confirm(restoreHash, true)
    if (restoreStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      return fail('RESTORE_TX_FAILED', 'Restore transaction failed', {
        onchainError: parseTransactionFailure(restoreStatus),
      })
    }
    params.onRestoreConfirmed?.(restoreHash)
    emit('restore_confirmed', { transactionHash: restoreHash })

    let rebuildTimeBounds = params.rebuildTimeBounds
    const expired = getExpiredTransactionInfo(originalTx)
    if (expired) {
      let replacement: RebuildTimeBounds | undefined
      try {
        replacement = await params.approveExpiredRebuild?.(expired)
      } catch (error) {
        return fail(
          'UNKNOWN_ERROR',
          walletErrorMessage(error),
          { expiredTransaction: expired },
          'rebuild',
        )
      }
      if (!replacement) {
        const error = new OriginalTransactionExpiredError(expired)
        return fail(error.code, error.message, { expiredTransaction: expired }, 'rebuild')
      }
      rebuildTimeBounds = replacement
    }

    // Rebuilt with a fresh sequence number whenever the network answers
    // tx_bad_seq: another client may have used the account in between.
    const maxRetries = config.maxSequenceRetries ?? MAX_SEQUENCE_RETRIES
    progress.sequenceRetries = 0
    for (;;) {
      const prepared = await buildOriginalAfterRestore(
        server,
        originalTx,
        networkPassphrase,
        originalTx.fee,
        signal,
        rebuildTimeBounds,
        wallet,
        pollInterval,
      )
      throwIfAborted(signal)
      params.onSigningOriginal?.()
      const signed = await sign(prepared)
      emit('original_submission_started')
      const sent = await bounded(
        () => send(signed),
        config.originalSubmissionTimeoutMs,
        'Original transaction submission',
      )
      if (!isTxBadSeqError(sent)) {
        assertSubmitted(sent, 'ORIGINAL_TX_FAILED', 'Original transaction')
        return finishOriginal(asTxHash(sent.hash))
      }
      if (progress.sequenceRetries >= maxRetries) {
        return fail(
          'ORIGINAL_TX_FAILED',
          `Original transaction rejected with tx_bad_seq after ${progress.sequenceRetries} retries`,
          {},
          'submission',
        )
      }
      progress.sequenceRetries++
    }
  }

  try {
    throwIfAborted(signal)
    // Fail before prompting rather than after the user has signed.
    if (params.feeBumpConfig) {
      assertWalletCapability(wallet, 'feeBump', 'submitWithRestore (fee-bump)')
    }
    await validateWalletNetwork(wallet, networkPassphrase, signal)
    emit('simulation_started')
    const simulation = await bounded(
      () => simulateWithCache(server, originalTx, params.simulationCache, signal),
      config.simulationTimeoutMs,
      'Transaction simulation',
    )

    if (isErrorResponse(simulation)) {
      return fail('SIMULATION_FAILED', `Simulation error: ${simulation.error}`)
    }
    if (isRestoreResponse(simulation)) return await restoreThenSubmit(simulation)
    if (!isSuccessResponse(simulation)) {
      return fail(
        'UNEXPECTED_SIMULATION_RESPONSE',
        'Cannot safely recover from simulation response (unrecognized-response): ' +
          'the RPC response is not a recognized success, error, or restore response.',
      )
    }

    // Protocol 23+: the call restores its archived entries itself.
    const autoRestored = extractAutoRestoredKeys(simulation)
    if (autoRestored.length > 0) {
      progress.archivedKeysDetected = autoRestored.length
      progress.restoreMode = 'automatic'
      emit('restore_preparation_started', { archivedKeys: autoRestored })
      params.onRestoreNeeded?.(autoRestored)
    }

    const assembled = assembleIfNeeded(originalTx, simulation)
    const enforceCap = (fee: string) => {
      const cap = config.maxRestoreFeeStroops
      if (autoRestored.length > 0 && cap !== undefined && BigInt(fee) > BigInt(cap)) {
        throw new RestoreFeeExceededError(Number(fee), Number(cap))
      }
    }
    enforceCap(assembled.fee)
    const transaction = await authorizeAndFinalize({
      server,
      transaction: assembled,
      simulation,
      wallet,
      networkPassphrase,
      signal,
    })
    enforceCap(transaction.fee)
    params.onSigningOriginal?.()
    const signed = await sign(transaction)
    emit('original_submission_started')
    const sent = await bounded(
      () => send(signed),
      config.originalSubmissionTimeoutMs,
      'Original transaction submission',
    )
    assertSubmitted(sent, 'ORIGINAL_TX_FAILED', 'Transaction')
    return await finishOriginal(asTxHash(sent.hash))
  } catch (err) {
    if (signal?.aborted) return fail('ABORTED', 'Operation cancelled')
    if (isConfirmationTimeout(err) && (progress.originalTxHash || progress.restoreTxHash)) {
      return fail(
        'CONFIRMATION_TIMEOUT',
        err.message,
        params.confirmationTimeoutBehavior === 'return-pending'
          ? { confirmationStatus: 'pending' }
          : {},
      )
    }
    return fail(getResurrectErrorCode(err), walletErrorMessage(err))
  }
}

/**
 * Signs and submits a single transaction using the wallet adapter, without
 * any automatic archive restoration. This is a lightweight alternative to
 * `submitWithRestore` for transactions known not to require restoration.
 *
 * Returns a `ResurrectResult` with the transaction hash on success.
 */
export async function sendTransaction(
  server: ISorobanRpcClient,
  transaction: Transaction,
  wallet: WalletAdapter,
  config: SorobanResurrectConfig,
  options: AbortSignalOptions = {},
): Promise<ResurrectResult> {
  const { signal } = options
  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

  try {
    throwIfAborted(signal)
    const isConnected = await runWithSignal(() => wallet.isConnected(), signal)
    if (!isConnected) {
      return {
        success: false,
        archivedKeysDetected: 0,
        error: 'Wallet is not connected',
        errorCode: 'WALLET_NOT_CONNECTED' as const,
        failure: createFailureGuidance('WALLET_NOT_CONNECTED'),
      }
    }

    await validateWalletNetwork(wallet, networkPassphrase, signal)
    const signedTx = await signAndVerifyTransaction(
      transaction,
      wallet,
      networkPassphrase,
      config,
      signal,
    )

    const result = await runWithSignal(() => server.sendTransaction(signedTx), signal)
    assertSubmitted(result, 'ORIGINAL_TX_FAILED', 'Transaction')

    return {
      success: true,
      originalTxHash: asTxHash(result.hash),
      archivedKeysDetected: 0,
    }
  } catch (err) {
    const message = walletErrorMessage(err)
    return {
      success: false,
      archivedKeysDetected: 0,
      error: message,
      errorCode: signal?.aborted
        ? ('ABORTED' as const)
        : err instanceof ResurrectError
          ? err.code
          : ('UNKNOWN_ERROR' as const),
    }
  }
}

/** Parameters for {@link restoreKeys}. */
export interface RestoreKeysParams {
  /** RPC client used for all Soroban network calls. */
  server: ISorobanRpcClient
  /**
   * Ledger keys to restore — `LedgerKeyContractData` and/or
   * `LedgerKeyContractCode` entries. Unlike `submitWithRestore`, these are
   * not derived from simulating a source transaction: pass any keys you
   * already know need restoring (proactive maintenance, restoring a
   * contract's data ahead of an upgrade, etc.).
   */
  keys: xdr.LedgerKey[]
  /** Wallet adapter used for signing. */
  wallet: WalletAdapter
  /** SDK configuration. */
  config: SorobanResurrectConfig
  /** Stops the operation and prevents subsequent workflow steps. */
  signal?: AbortSignal
}

/**
 * Restores an arbitrary list of ledger keys, with no source transaction
 * required.
 *
 * Every other restore path in this SDK discovers archived keys by simulating
 * a transaction that touches them. This is for the case where the caller
 * already knows which keys need restoring — a scheduled sweep of entries
 * approaching TTL expiry (see `TTLHelpers.getExpiringSoonEntries`), or
 * restoring a contract's storage before an upgrade touches it.
 *
 * A `restoreFootprint` transaction is built directly from `keys` and
 * simulated once — not to detect whether restore is needed (it always is,
 * here), but because that simulation is how the real `minResourceFee` for
 * exactly these keys is obtained, same as every other restore fee in this
 * SDK. `config.maxRestoreFeeStroops`, if set, applies here too.
 *
 * Never throws — every failure path returns
 * `ResurrectResult { success: false, error }`.
 *
 * @example
 * ```ts
 * const result = await resurrect.restoreKeys([contractDataKey, contractCodeKey], wallet)
 * if (result.success) console.log('Restored:', result.restoreTxHash)
 * ```
 */
export async function restoreKeys(params: RestoreKeysParams): Promise<ResurrectResult> {
  const { server, keys, wallet, config, signal } = params
  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
  assertBatchSize(keys.length, config.maxBatchSize ?? 100, 'restoreKeys')

  if (keys.length === 0) {
    const error = 'restoreKeys called with an empty key list'
    return {
      success: false,
      archivedKeysDetected: 0,
      error,
      errorCode: 'INVALID_RESTORE_KEYS',
      failure: createFailureGuidance('INVALID_RESTORE_KEYS'),
    }
  }

  try {
    throwIfAborted(signal)
    const isConnected = await runWithSignal(() => wallet.isConnected(), signal)
    if (!isConnected) {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        error: 'Wallet is not connected',
        errorCode: 'WALLET_NOT_CONNECTED',
        failure: createFailureGuidance('WALLET_NOT_CONNECTED'),
      }
    }

    const publicKey = await runWithSignal(() => wallet.getPublicKey(), signal)
    const account = await runWithSignal(() => server.getAccount(publicKey), signal)

    // A placeholder-fee restoreFootprint tx over exactly these keys, built
    // only so it can be simulated for its real minResourceFee — mirrors what
    // simulating a source transaction gives the footprint-derived restore
    // path, without requiring one.
    const placeholderData = new SorobanDataBuilder().setReadWrite(keys).build()
    const placeholderTx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.restoreFootprint({}))
      .setSorobanData(placeholderData)
      .setTimeout(30)
      .build()

    const simResponse = await runWithSignal(() => server.simulateTransaction(placeholderTx), signal)
    if (isErrorResponse(simResponse)) {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        error: `Simulation error: ${simResponse.error}`,
        errorCode: 'SIMULATION_FAILED',
        failure: createFailureGuidance('SIMULATION_FAILED'),
      }
    }

    const minResourceFee = parseInt(simResponse.minResourceFee, 10)
    const transactionData = isSuccessResponse(simResponse)
      ? simResponse.transactionData.build()
      : placeholderData

    const restoreTx = await runWithSignal(
      () =>
        buildRestoreTransaction({
          server,
          sourcePublicKey: publicKey,
          transactionData,
          minResourceFee,
          latestLedger: simResponse.latestLedger,
          config,
          account,
          signal,
        }),
      signal,
    )

    const signedTx = await signAndVerifyTransaction(
      restoreTx,
      wallet,
      networkPassphrase,
      config,
      signal,
    )

    const sendResult = await runWithSignal(() => server.sendTransaction(signedTx), signal)
    if (isTxBadSeqError(sendResult)) {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        error: 'Restore transaction rejected with tx_bad_seq',
        errorCode: 'RESTORE_TX_FAILED',
        failure: createFailureGuidance('RESTORE_TX_FAILED', 'submission'),
      }
    }
    if (sendResult.status === 'ERROR' || sendResult.status === 'TRY_AGAIN_LATER') {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        error: 'Restore transaction submission failed',
        errorCode: 'RESTORE_TX_FAILED',
        failure: createFailureGuidance('RESTORE_TX_FAILED', 'submission'),
      }
    }
    const restoreHash = asTxHash(sendResult.hash)

    const status = await waitForTx(server, restoreHash, config, signal)
    if (status.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      const onchainError = parseTransactionFailure(status)
      return {
        success: false,
        archivedKeysDetected: keys.length,
        restoreTxHash: restoreHash,
        error: 'Restore transaction failed to confirm',
        errorCode: 'RESTORE_TX_FAILED',
        failure: createFailureGuidance('RESTORE_TX_FAILED'),
        ...(onchainError ? { onchainError } : {}),
      }
    }

    return {
      success: true,
      restoreTxHash: restoreHash,
      archivedKeysDetected: keys.length,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      archivedKeysDetected: keys.length,
      error: message,
      errorCode: signal?.aborted ? 'ABORTED' : getResurrectErrorCode(err),
    }
  }
}
