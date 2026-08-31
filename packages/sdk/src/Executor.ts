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
} from './types.js'
import {
  isRestoreResponse,
  isSuccessResponse,
  isErrorResponse,
  extractArchivedKeys,
} from './Archiver.js'
import {
  buildRestoreTransaction,
  waitForTransaction,
  waitForTransactionSSE,
  buildOriginalAfterRestore,
  buildFeeBumpTransaction,
  submitFeeBumpTransaction,
} from './Restorer.js'
import { SimulationCache } from './SimulationCache.js'
import {
  DEFAULT_NETWORK_PASSPHRASE,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  MAX_SEQUENCE_RETRIES,
} from './constants.js'
import { asTxHash, asXdrBase64, type TxHash } from './branded-types.js'

/**
 * True when a `sendTransaction` response was rejected because the account's
 * sequence number had already moved past what the transaction was built
 * with — i.e. the account was bumped by something else between building the
 * transaction and submitting it.
 *
 * Checks the decoded `errorResult` first (the reliable signal on an `ERROR`
 * response), then falls back to a substring match on a thrown error's
 * message — some RPC client wrappers surface `tx_bad_seq` as a rejected
 * promise rather than an `ERROR`-status response.
 */
export function isTxBadSeqError(value: rpc.Api.SendTransactionResponse | Error | unknown): boolean {
  if (value instanceof Error) {
    return value.message.includes('tx_bad_seq')
  }
  const response = value as Partial<rpc.Api.SendTransactionResponse> & {
    errorResult?: { result?: () => { switch?: () => { name?: string } } }
  }
  if (response?.status !== 'ERROR') {
    return false
  }
  try {
    return response.errorResult?.result?.()?.switch?.()?.name === 'txBadSeq'
  } catch {
    return false
  }
}

/** Parameters for the full restore-and-submit execution flow. */
export interface ExecuteParams {
  /** RPC client used for all Soroban network calls. */
  server: ISorobanRpcClient
  /** The original transaction to submit (may need restore first). */
  transaction: Transaction
  /** Wallet adapter used for signing. */
  wallet: WalletAdapter
  /** SDK configuration. */
  config: SorobanResurrectConfig
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
  server: ISorobanRpcClient
  onSigning?: () => void
  onSigningFeeBump?: () => void
  onSubmitting?: () => void
}): Promise<{ hash: TxHash }> {
  const {
    tx,
    wallet,
    feeBumpConfig,
    networkPassphrase,
    server,
    onSigning,
    onSigningFeeBump,
    onSubmitting,
  } = params

  onSigning?.()
  const signedXdr = await wallet.signTransaction(asXdrBase64(tx.toXDR()), { networkPassphrase })

  // If no fee-bump, submit directly
  if (!feeBumpConfig) {
    const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
    if (!(signedTx instanceof Transaction)) {
      throw new Error('Failed to parse signed transaction')
    }
    onSubmitting?.()
    const result = await server.sendTransaction(signedTx)
    return { hash: asTxHash(result.hash) }
  }

  // Fee-bump flow: wrap the signed inner tx in a fee-bump
  onSigningFeeBump?.()
  const feeBumpXdr = await buildFeeBumpTransaction(
    signedXdr,
    feeBumpConfig.sponsor,
    networkPassphrase,
    feeBumpConfig.feeBumpFee,
  )

  onSubmitting?.()
  const result = await submitFeeBumpTransaction(server, feeBumpXdr, networkPassphrase)
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
): Promise<rpc.Api.SimulateTransactionResponse> {
  if (cache) {
    const cached = cache.get(tx)
    if (cached) {
      return cached as rpc.Api.SimulateTransactionResponse
    }
    const response = await server.simulateTransaction(tx)
    cache.set(tx, response)
    return response
  }
  return server.simulateTransaction(tx)
}

/**
 * Helper: waits for a transaction using SSE if configured, otherwise polls.
 */
async function waitForTx(
  server: rpc.Server,
  hash: TxHash | string,
  config: SorobanResurrectConfig,
): Promise<rpc.Api.GetTransactionResponse> {
  const pollTimeout = config.pollTimeoutMs ?? POLL_TIMEOUT_MS

  if (config.useSSE) {
    return waitForTransactionSSE(server, hash, pollTimeout)
  }

  const pollInterval = config.pollIntervalMs ?? POLL_INTERVAL_MS
  return waitForTransaction(server, hash, pollInterval, pollTimeout)
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
export async function executeWithRestore(params: ExecuteParams): Promise<ResurrectResult> {
  const {
    server,
    transaction: originalTx,
    wallet,
    config,
    onRestoreNeeded,
    onRestoreSubmitted,
    onRestoreConfirmed,
    onOriginalSubmitted,
    onRestoreFailed,
    onSigningFeeBump,
  } = params

  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

  // Extract optional fields that may not be destructured from params
  const onSigningRestore = (params as ExecuteParams & { onSigningRestore?: () => void })
    .onSigningRestore
  const onSubmittingRestore = (params as ExecuteParams & { onSubmittingRestore?: () => void })
    .onSubmittingRestore
  const onSigningOriginal = (params as ExecuteParams & { onSigningOriginal?: () => void })
    .onSigningOriginal
  const feeBumpConfig = (params as ExecuteParams & { feeBumpConfig?: FeeBumpConfig }).feeBumpConfig
  const simulationCache = (params as ExecuteParams & { simulationCache?: SimulationCache })
    .simulationCache
  const pollInterval = config.pollIntervalMs ?? POLL_INTERVAL_MS
  const pollTimeout = config.pollTimeoutMs ?? POLL_TIMEOUT_MS

  try {
    const simResponse = await simulateWithCache(server, originalTx, simulationCache)

    if (isErrorResponse(simResponse)) {
      const err = `Simulation error: ${simResponse.error}`
      onRestoreFailed?.(err)
      return { success: false, archivedKeysDetected: 0, error: err }
    }

    if (isRestoreResponse(simResponse)) {
      const archivedKeys = extractArchivedKeys(simResponse)

      const isConnected = await wallet.isConnected()
      if (!isConnected) {
        const err = 'Wallet is not connected'
        onRestoreFailed?.(err)
        return { success: false, archivedKeysDetected: archivedKeys.length, error: err }
      }

      const publicKey = await wallet.getPublicKey()
      const account = await server.getAccount(publicKey)

      const restoreTx = await buildRestoreTransaction({
        server,
        sourcePublicKey: publicKey,
        transactionData: simResponse.transactionData.build(),
        minResourceFee: parseInt(simResponse.minResourceFee, 10),
        config,
        account,
      })

      // Defer onRestoreNeeded until after restore tx is built
      onRestoreNeeded?.(archivedKeys)

      onSigningRestore?.()
      const signedRestoreXdr = await wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), {
        networkPassphrase,
      })

      const signedRestoreTx = TransactionBuilder.fromXDR(signedRestoreXdr, networkPassphrase)
      if (!(signedRestoreTx instanceof Transaction)) {
        const err = 'Failed to parse signed restore transaction'
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          error: err,
        }
      }

      onSubmittingRestore?.()
      const restoreResult = await server.sendTransaction(signedRestoreTx)
      const restoreHash = asTxHash(restoreResult.hash)
      onRestoreSubmitted?.(restoreHash)

      const restoreStatus = await waitForTransaction(server, restoreHash, pollInterval, pollTimeout)

      if (restoreStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        const err = 'Restore transaction failed'
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          restoreTxHash: restoreHash,
          error: err,
        }
      }

      onRestoreConfirmed?.(restoreHash)

      // Rebuild-and-resubmit on tx_bad_seq: the account can be bumped by
      // another client between fetching its sequence number here and the
      // submission below, and that race only gets more likely right after a
      // restore transaction was just posted from the same account. Each
      // attempt calls buildOriginalAfterRestore fresh, which re-fetches the
      // account and so picks up whatever sequence number is current.
      const maxSequenceRetries = config.maxSequenceRetries ?? MAX_SEQUENCE_RETRIES
      let sequenceRetries = 0
      let originalHash: TxHash

      for (;;) {
        const preparedTx = await buildOriginalAfterRestore(
          server,
          originalTx,
          networkPassphrase,
          originalTx.fee,
        )

        onSigningOriginal?.()
        const signedOriginalXdr = await wallet.signTransaction(asXdrBase64(preparedTx.toXDR()), {
          networkPassphrase,
        })

        const signedOriginalTx = TransactionBuilder.fromXDR(signedOriginalXdr, networkPassphrase)
        if (!(signedOriginalTx instanceof Transaction)) {
          const err = 'Failed to parse signed original transaction'
          onRestoreFailed?.(err)
          return {
            success: false,
            archivedKeysDetected: archivedKeys.length,
            error: err,
          }
        }

        let originalResult: rpc.Api.SendTransactionResponse
        try {
          originalResult = await server.sendTransaction(signedOriginalTx)
        } catch (submitErr) {
          if (isTxBadSeqError(submitErr) && sequenceRetries < maxSequenceRetries) {
            sequenceRetries++
            continue
          }
          throw submitErr
        }

        if (isTxBadSeqError(originalResult)) {
          if (sequenceRetries < maxSequenceRetries) {
            sequenceRetries++
            continue
          }
          const err = `Original transaction rejected with tx_bad_seq after ${sequenceRetries} retries`
          onRestoreFailed?.(err)
          return {
            success: false,
            archivedKeysDetected: archivedKeys.length,
            restoreTxHash: restoreHash,
            error: err,
            sequenceRetries,
          }
        }

        originalHash = asTxHash(originalResult.hash)
        break
      }

      onOriginalSubmitted?.(originalHash)

      return {
        success: true,
        originalTxHash: originalHash,
        restoreTxHash: restoreHash,
        archivedKeysDetected: archivedKeys.length,
        ...(sequenceRetries > 0 ? { sequenceRetries } : {}),
      }
    }

    if (isSuccessResponse(simResponse)) {
      const { hash } = await signAndMaybeFeeBump({
        tx: originalTx,
        wallet,
        feeBumpConfig,
        networkPassphrase,
        server,
        onSigning: onSigningOriginal,
        onSigningFeeBump,
      })

      onOriginalSubmitted?.(hash)

      // Wait for confirmation on success path for consistency with restore path
      const txStatus = await waitForTx(server, hash, config)

      if (txStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        return { success: false, archivedKeysDetected: 0, error: 'Transaction failed to confirm' }
      }

      return {
        success: true,
        originalTxHash: hash,
        archivedKeysDetected: 0,
      }
    }

    const err = 'Unexpected simulation response type'
    onRestoreFailed?.(err)
    return { success: false, archivedKeysDetected: 0, error: err }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onRestoreFailed?.(message)
    return { success: false, archivedKeysDetected: 0, error: message }
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
): Promise<ResurrectResult> {
  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

  try {
    const isConnected = await wallet.isConnected()
    if (!isConnected) {
      return {
        success: false,
        archivedKeysDetected: 0,
        error: 'Wallet is not connected',
      }
    }

    const signedXdr = await wallet.signTransaction(asXdrBase64(transaction.toXDR()), {
      networkPassphrase,
    })

    const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
    if (!(signedTx instanceof Transaction)) {
      return {
        success: false,
        archivedKeysDetected: 0,
        error: 'Failed to parse signed transaction',
      }
    }

    const result = await server.sendTransaction(signedTx)

    return {
      success: true,
      originalTxHash: asTxHash(result.hash),
      archivedKeysDetected: 0,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      archivedKeysDetected: 0,
      error: message,
    }
  }
}

/**
 * Internal wrapper around `waitForTransaction` that fires `onConfirming` on
 * each poll attempt. Delegates polling logic to the core `waitForTransaction`
 * helper from Restorer.ts but adds callback support.
 */
async function waitForTransactionWithCallbacks(
  server: rpc.Server,
  hash: TxHash | string,
  pollIntervalMs: number,
  pollTimeoutMs: number,
  onConfirming?: (txHash: TxHash | string, attempt: number) => void,
): Promise<rpc.Api.GetTransactionResponse> {
  const startTime = Date.now()
  let attempt = 0

  while (Date.now() - startTime < pollTimeoutMs) {
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
    const jitter = delay * (0.5 + Math.random() * 0.5)
    await new Promise((resolve) => setTimeout(resolve, jitter))
  }

  throw new Error(`Transaction ${hash} did not complete within ${pollTimeoutMs}ms`)
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
  const { server, keys, wallet, config } = params
  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

  if (keys.length === 0) {
    return {
      success: false,
      archivedKeysDetected: 0,
      error: 'restoreKeys called with an empty key list',
    }
  }

  try {
    const isConnected = await wallet.isConnected()
    if (!isConnected) {
      return { success: false, archivedKeysDetected: keys.length, error: 'Wallet is not connected' }
    }

    const publicKey = await wallet.getPublicKey()
    const account = await server.getAccount(publicKey)

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

    const simResponse = await server.simulateTransaction(placeholderTx)
    if (isErrorResponse(simResponse)) {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        error: `Simulation error: ${simResponse.error}`,
      }
    }

    const minResourceFee = parseInt(simResponse.minResourceFee, 10)
    const transactionData = isSuccessResponse(simResponse)
      ? simResponse.transactionData.build()
      : placeholderData

    const restoreTx = await buildRestoreTransaction({
      server,
      sourcePublicKey: publicKey,
      transactionData,
      minResourceFee,
      config,
      account,
    })

    const signedXdr = await wallet.signTransaction(asXdrBase64(restoreTx.toXDR()), {
      networkPassphrase,
    })
    const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
    if (!(signedTx instanceof Transaction)) {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        error: 'Failed to parse signed restore transaction',
      }
    }

    const sendResult = await server.sendTransaction(signedTx)
    if (isTxBadSeqError(sendResult)) {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        error: 'Restore transaction rejected with tx_bad_seq',
      }
    }
    const restoreHash = asTxHash(sendResult.hash)

    const status = await waitForTx(server, restoreHash, config)
    if (status.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        success: false,
        archivedKeysDetected: keys.length,
        restoreTxHash: restoreHash,
        error: 'Restore transaction failed to confirm',
      }
    }

    return {
      success: true,
      restoreTxHash: restoreHash,
      archivedKeysDetected: keys.length,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, archivedKeysDetected: keys.length, error: message }
  }
}
