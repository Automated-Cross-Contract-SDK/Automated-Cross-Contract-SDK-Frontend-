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
import type {
  SorobanResurrectConfig,
  WalletAdapter,
  FeeBumpConfig,
  ArchivedLedgerEntry,
  ResurrectResult,
  DryRunResult,
  SubmitLifecycleEvent,
  ConfirmationPolicy,
  ConfirmationTimeoutBehavior,
} from './types.js'
import type { ResurrectErrorCode } from './errors.js'
import { IncompleteFootprintError } from './SimulationFootprint.js'
import {
  OriginalTransactionExpiredError,
  ResurrectError,
} from './errors.js'
import {
  isRestoreResponse,
  isSuccessResponse,
  isErrorResponse,
  extractArchivedKeys,
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
import { ensureAddressAuthorization } from './Authorization.js'
import {
  DEFAULT_NETWORK_PASSPHRASE,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  MAX_SEQUENCE_RETRIES,
} from './constants.js'
import { asTxHash, asXdrBase64, type TxHash, type XdrBase64 } from './branded-types.js'
import { parseTransactionFailure } fycle-safety
import { createFailureGuidrom './TransactionFailure.js'
import { runWithSignal, throwIfAborted, type AbortSignalOptions } from './AbortUtils.js'

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
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'USER_REJECTED'
  ) {
    return 'Signature request declined'
  }
  return error instanceof Error ? error.message : String(error)
}

function expiredRebuildResult(
  expiredTransaction: ExpiredTransactionInfo,
  archivedKeysDetected: number,
  restoreTxHash: TxHash,
  sequenceRetries = 0,
): ResurrectResult {
  const error = new OriginalTransactionExpiredError(expiredTransaction)
  return {
    success: false,
    archivedKeysDetected,
    restoreTxHash,
    error: error.message,
    errorCode: error.code,
    failure: createFailureGuidance(error.code, 'rebuild'),
    expiredTransaction,
    sequenceRetries,
  }
}

/**
 * Helper: signs a transaction with the user's wallet and optionally wraps it
 * in a fee-bump envelope signed by the sponsor. Returns the final XDR and hash.
 *
 * Callbacks fire in order:
 * - onSigning → before wallet signature
 * - onSigningFeeBump → before sponsor fee-bump signature (only if fee-bump)
 * - onSubmitting → right before the final submission
 */
async function signAndMaybeFeeBump(params: {
  tx: Transaction
  wallet: WalletAdapter
  feeBumpConfig?: FeeBumpConfig
  networkPassphrase: string
  config: Pick<SorobanResurrectConfig, 'logger'>
  server: ISorobanRpcClient
  signal?: AbortSignal
  onSigning?: () => void
  onSigningFeeBump?: () => void
  onSubmitting?: () => void
  signal?: AbortSignal
}): Promise<{ hash: TxHash }> {
  const {
    tx,
    wallet,
    feeBumpConfig,
    networkPassphrase,
    config,
    server,
    signal,
    onSigning,
    onSigningFeeBump,
    onSubmitting,
    signal,
  } = params

  throwIfCancelled(signal)

  // Fail fast when a fee-bump is requested but the wallet has opted out of it,
  // rather than prompting the user only to reject the envelope later.
  if (feeBumpConfig) {
    assertWalletCapability(wallet, 'feeBump', 'submitWithRestore (fee-bump)')
  }

  onSigning?.()
  const walletOptions = signal ? { networkPassphrase, signal } : { networkPassphrase }
  const signedXdr = await runWithSignal(
    () => wallet.signTransaction(asXdrBase64(tx.toXDR()), walletOptions),
    signal,
  )

  // If no fee-bump, submit directly
  if (!feeBumpConfig) {
    const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
    if (!(signedTx instanceof Transaction)) {
      throw new Error('Failed to parse signed transaction')
    }
    throwIfAborted(signal)
    onSubmitting?.()
    const result = await runWithSignal(() => server.sendTransaction(signedTx), signal)
    return { hash: asTxHash(result.hash) }
  }

  // Fee-bump flow: wrap the signed inner tx in a fee-bump
  throwIfAborted(signal)
  onSigningFeeBump?.()
  const feeBumpXdr = await runWithSignal(
    () =>
      buildFeeBumpTransaction(
        signedXdr,
        feeBumpConfig.sponsor,
        networkPassphrase,
        feeBumpConfig.feeBumpFee,
      ),
    signal,
  )

  throwIfAborted(signal)
  onSubmitting?.()
  const result = await runWithSignal(
    () => submitFeeBumpTransaction(server, feeBumpXdr, networkPassphrase),
    signal,
  )
  return { hash: asTxHash(result.hash) }
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
  const runtime = config.runtime ?? SYSTEM_RUNTIME

  if (config.useSSE) {
    return waitForTransactionSSE(server, hash, pollTimeout, config.rpcUrl, { signal })
  }

  const pollInterval = config.pollIntervalMs ?? POLL_INTERVAL_MS
  return waitForTransaction(server, hash, pollInterval, pollTimeout, { signal })
}

function isConfirmationTimeout(error: unknown): error is Error {
  return error instanceof Error && /did not complete within \d+ms/i.test(error.message)
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

export async function executeWithRestore(params: ExecuteParams): Promise<ResurrectResult> {
  const {
    server,
    transaction: originalTx,
    wallet,
    config,
    signal,
    onRestoreNeeded,
    onRestoreSubmitted,
    onRestoreConfirmed,
    onOriginalSubmitted,
    onRestoreFailed,
    onSigningFeeBump,
    signal,
  } = params

  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

  const onSigningOriginal = params.onSigningOriginal
  const pollTimeout = config.pollTimeoutMs ?? POLL_TIMEOUT_MS
  let archivedKeysDetected = 0
  let restoreTxHash: TxHash | undefined
  let originalTxHash: TxHash | undefined

  try {
    throwIfAborted(signal)
    await validateWalletNetwork(wallet, networkPassphrase, signal)
    const simResponse = await simulateWithCache(server, originalTx, simulationCache, signal)

    if (isErrorResponse(simResponse)) {
      const err = `Simulation error: ${simResponse.error}`
      onRestoreFailed?.(err)
      return {
        success: false,
        archivedKeysDetected: 0,
        error: err,
        errorCode: 'SIMULATION_FAILED',
        failure: createFailureGuidance('SIMULATION_FAILED'),
      }
    }

    if (isRestoreResponse(simResponse)) {
      const archivedKeys = extractArchivedKeys(simResponse)
      archivedKeysDetected = archivedKeys.length
      debug('executeWithRestore: restore required for %d entries', archivedKeys.length)
      onLifecycleEvent?.({
        phase: 'restore_preparation_started',
        requestId,
        archivedKeys,
      })

      const isConnected = await runWithSignal(() => wallet.isConnected(), signal)
      if (!isConnected) {
        const err = 'Wallet is not connected'
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          error: err,
          errorCode: 'WALLET_NOT_CONNECTED',
          failure: createFailureGuidance('WALLET_NOT_CONNECTED'),
        }
      }

      const publicKey = await runWithSignal(() => wallet.getPublicKey(), signal)
      const account = await runWithSignal(() => server.getAccount(publicKey), signal)

      const restoreTx = await runWithSignal(
        () =>
          buildRestoreTransaction({
            server,
            sourcePublicKey: publicKey,
            transactionData: simResponse.transactionData.build(),
            minResourceFee: parseInt(simResponse.minResourceFee, 10),
            config,
            account,
          }),
        signal,
      )

      // Defer onRestoreNeeded until after restore tx is built
      throwIfAborted(signal)
      onRestoreNeeded?.(archivedKeys)

      throwIfAborted(signal)
      onSigningRestore?.()
      const walletOptions = signal ? { networkPassphrase, signal } : { networkPassphrase }
      const signedRestoreXdr = await runWithSignal(
        () => wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), walletOptions),
        signal,
      )

      const signedRestoreTx = TransactionBuilder.fromXDR(signedRestoreXdr, networkPassphrase)
      if (!(signedRestoreTx instanceof Transaction)) {
        const err = 'Failed to parse signed restore transaction'
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          error: err,
          errorCode: 'RESTORE_TX_PARSE_FAILED',
          failure: createFailureGuidance('RESTORE_TX_PARSE_FAILED'),
        }
      }

      throwIfAborted(signal)
      onSubmittingRestore?.()
      const restoreResult = await runWithSignal(() => server.sendTransaction(signedRestoreTx), signal)
      restoreTxHash = asTxHash(restoreResult.hash)
      onRestoreSubmitted?.(restoreTxHash)

      const restoreStatus = await waitForTransaction(server, restoreTxHash, pollInterval, pollTimeout, {
        signal,
      })

      if (restoreStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        const err = 'Restore transaction failed'
        const onchainError = parseTransactionFailure(restoreStatus)
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          restoreTxHash,
          error: err,
          errorCode: 'RESTORE_TX_FAILED',
          onchainError,
        }
      }

      onRestoreConfirmed?.(restoreTxHash)

      const maxSequenceRetries = config.maxSequenceRetries ?? MAX_SEQUENCE_RETRIES

      let sequenceRetries = 0
      let originalResult: rpc.Api.SendTransactionResponse | undefined
      let approvedRebuildTimeBounds = params.rebuildTimeBounds

      const originallyExpired = getExpiredTransactionInfo(originalTx)
      if (originallyExpired) {
        let replacementBounds: RebuildTimeBounds | undefined
        try {
          replacementBounds = await params.approveExpiredRebuild?.(originallyExpired)
        } catch (error) {
          const message = walletErrorMessage(error)
          onRestoreFailed?.(message)
          return {
            success: false,
            archivedKeysDetected: archivedKeys.length,
            restoreTxHash: restoreHash,
            error: message,
            errorCode: 'UNKNOWN_ERROR',
            failure: createFailureGuidance('UNKNOWN_ERROR', 'rebuild'),
            expiredTransaction: originallyExpired,
          }
        }
        if (!replacementBounds) {
          const result = expiredRebuildResult(
            originallyExpired,
            archivedKeys.length,
            restoreHash,
          )
          onRestoreFailed?.(result.error ?? 'Original transaction time bounds have expired')
          return result
        }
        approvedRebuildTimeBounds = replacementBounds
      }

      // Rebuild + sign + submit the original transaction. Retried (with a
      // freshly-fetched sequence number) if the network rejects it with
      // tx_bad_seq — the account may have been bumped by another client
      // between the rebuild above and this submission.
      for (;;) {
        const preparedTx = await runWithSignal(
          () =>
            buildOriginalAfterRestore(
              server,
              originalTx,
              networkPassphrase,
              originalTx.fee,
              signal,
            ),
          signal,
        )
        throwIfCancelled(signal)

        throwIfAborted(signal)
        onSigningOriginal?.()
        const originalWalletOptions = signal
          ? { networkPassphrase, signal }
          : { networkPassphrase }
        const signedOriginalXdr = await runWithSignal(
          () => wallet.signTransaction(asXdrBase64(preparedTx.toXDR()), originalWalletOptions),
          signal,
        )

        const signedOriginalTx = TransactionBuilder.fromXDR(signedOriginalXdr, networkPassphrase)
        if (!(signedOriginalTx instanceof Transaction)) {
          const err = 'Failed to parse signed original transaction'
          onRestoreFailed?.(err)
          return {
            success: false,
            archivedKeysDetected: archivedKeys.length,
            restoreTxHash,
            error: err,
            errorCode: 'ORIGINAL_TX_PARSE_FAILED',
            failure: createFailureGuidance('ORIGINAL_TX_PARSE_FAILED'),
            sequenceRetries,
          }
        }

        originalResult = await runWithSignal(
          () => server.sendTransaction(signedOriginalTx),
          signal,
        )

        if (!isTxBadSeqError(originalResult) || sequenceRetries >= maxSequenceRetries) {
          break
        }

        sequenceRetries++
      }

      if (isTxBadSeqError(originalResult!)) {
        const err = `Original transaction rejected with tx_bad_seq after ${sequenceRetries} retries`
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          restoreTxHash,
          error: err,
          errorCode: 'ORIGINAL_TX_FAILED',
          failure: createFailureGuidance('ORIGINAL_TX_FAILED', 'submission'),
          sequenceRetries,
        }
      }

      originalTxHash = asTxHash(originalResult!.hash)
      onOriginalSubmitted?.(originalTxHash)

      const result: ResurrectResult = {
        success: true,
        originalTxHash,
        restoreTxHash,
        archivedKeysDetected: archivedKeys.length,
      }
    }

    if (isSuccessResponse(simResponse)) {
      // CAP-0046 fine-grained auth: if simulation surfaced address-credential
      // auth entries, sign + attach them with the wallet's signAuthEntry
      // before signing the transaction itself. If the wallet can't sign them
      // and they're required, ensureAddressAuthorization throws a clear error
      // which the outer catch turns into { success: false, error }.
      const { transaction: txToSubmit } = await runWithSignal(
        () =>
          ensureAddressAuthorization({
            transaction: originalTx,
            simulation: simResponse,
            wallet,
            networkPassphrase,
            signal,
          }),
        signal,
      )

      const { hash } = await signAndMaybeFeeBump({
        tx: txToSubmit,
        wallet,
        feeBumpConfig,
        networkPassphrase,
        config,
        server,
        signingTimeoutMs: signingTimeout,
        submissionTimeoutMs: originalSubmissionTimeout,
        onSigning: onSigningOriginal,
        onSigningFeeBump,
        signal,
      })

      originalTxHash = hash
      onOriginalSubmitted?.(hash)
      onLifecycleEvent?.({
        phase: 'original_submitted',
        requestId,
        transactionHash: hash,
      })

      if (effectiveConfirmationPolicy === 'return-on-submission') {
        return {
          success: true,
          originalTxHash: hash,
          archivedKeysDetected: 0,
          confirmationStatus: 'submitted',
        }
      }

      // Wait for confirmation on success path for consistency with restore path
      const txStatus = await waitForTx(server, hash, config, signal)

      if (txStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        const onchainError = parseTransactionFailure(txStatus)
        return {
          success: false,
          archivedKeysDetected: 0,
          originalTxHash: hash,
          error: 'Transaction failed to confirm',
          errorCode: 'ORIGINAL_TX_FAILED',
          onchainError,
        }
      }

      onLifecycleEvent?.({
        phase: 'original_confirmed',
        requestId,
        transactionHash: hash,
      })
      return {
        success: true,
        originalTxHash: hash,
        archivedKeysDetected: 0,
        confirmationStatus: 'confirmed',
      }
    }

    const err =
      'Cannot safely recover from simulation response (unrecognized-response): ' +
      'the RPC response is not a recognized success, error, or restore response.'
    onRestoreFailed?.(err)
    return {
      success: false,
      archivedKeysDetected: 0,
      error: err,
      errorCode: 'UNEXPECTED_SIMULATION_RESPONSE',
      failure: createFailureGuidance('UNEXPECTED_SIMULATION_RESPONSE'),
    }
  } catch (err) {
    const message = signal?.aborted ? 'Operation cancelled' : walletErrorMessage(err)
    onRestoreFailed?.(message)
    return {
      success: false,
      archivedKeysDetected,
      restoreTxHash,
      originalTxHash,
      error: message,
      errorCode: signal?.aborted ? 'ABORTED' : 'UNKNOWN_ERROR',
    }
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
    const walletOptions = signal ? { networkPassphrase, signal } : { networkPassphrase }
    const signedXdr = await runWithSignal(
      () => wallet.signTransaction(asXdrBase64(transaction.toXDR()), walletOptions),
      signal,
    )

    const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
    if (!(signedTx instanceof Transaction)) {
      return {
        success: false,
        archivedKeysDetected: 0,
        error: 'Failed to parse signed transaction',
        errorCode: 'ORIGINAL_TX_PARSE_FAILED' as const,
        failure: createFailureGuidance('ORIGINAL_TX_PARSE_FAILED'),
      }
    }

    const result = await runWithSignal(() => server.sendTransaction(signedTx), signal)

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
      errorCode: signal?.aborted ? ('ABORTED' as const) : ('UNKNOWN_ERROR' as const),
    }
  }
}

/**
 * Internal wrapper around `waitForTransaction` that fires `onConfirming` on
 * each poll attempt. Delegates polling logic to the core `waitForTransaction`
 * helper from Restorer.ts but adds callback support.
 */
async function waitForTransactionWithCallbacks(
  server: ISorobanRpcClient,
  hash: TxHash | string,
  pollIntervalMs: number,
  pollTimeoutMs: number,
  onConfirming?: (txHash: TxHash | string, attempt: number) => void,
  runtime: SdkRuntime = SYSTEM_RUNTIME,
): Promise<rpc.Api.GetTransactionResponse> {
  const startTime = runtime.now()
  let attempt = 0

  while (runtime.now() - startTime < pollTimeoutMs) {
    const response = await server.getTransaction(hash)

    if (
      response.status === rpc.Api.GetTransactionStatus.SUCCESS ||
      response.status === rpc.Api.GetTransactionStatus.FAILED
    ) {
      return response
    }

    attempt++
    onConfirming?.(hash, attempt)

    // Exponential backoff with jitter: delay = min(100ms * 2^attempt, pollIntervalMs) * (0.5 + random * 0.5)
    const exponentialDelay = 100 * Math.pow(2, attempt)
    const delay = Math.min(exponentialDelay, pollIntervalMs)
    const jitter = delay * (0.5 + runtime.random() * 0.5)
    await new Promise<void>((resolve) => runtime.setTimeout(resolve, jitter))
  }

  throw new ResurrectTimeoutError(`Transaction ${hash} did not complete within ${pollTimeoutMs}ms`)
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

    const simResponse = await runWithSignal(
      () => server.simulateTransaction(placeholderTx),
      signal,
    )
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
          config,
          account,
        }),
      signal,
    )

    const walletOptions = signal ? { networkPassphrase, signal } : { networkPassphrase }
    const signedXdr = await runWithSignal(
      () => wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), walletOptions),
      signal,
    )
    const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
    if (!(signedTx instanceof Transaction)) {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        error: 'Failed to parse signed restore transaction',
        errorCode: 'RESTORE_TX_PARSE_FAILED',
        failure: createFailureGuidance('RESTORE_TX_PARSE_FAILED'),
      }
    }

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
    if (sendResult.status === 'ERROR') {
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
      errorCode: signal?.aborted ? 'ABORTED' : 'UNKNOWN_ERROR',
    }
  }
}
