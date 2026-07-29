import { rpc, TransactionBuilder, Transaction } from '@stellar/stellar-sdk'
import {
  SorobanResurrectConfig,
  WalletAdapter,
  ArchivedLedgerEntry,
  ResurrectResult,
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
  buildOriginalAfterRestore,
} from './Restorer.js'
import { DEFAULT_NETWORK_PASSPHRASE, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from './constants.js'

/** Parameters for the full restore-and-submit execution flow. */
export interface ExecuteParams {
  /** Soroban RPC server instance. */
  server: rpc.Server
  /** The original transaction to submit (may need restore first). */
  transaction: Transaction
  /** Wallet adapter used for signing. */
  wallet: WalletAdapter
  /** SDK configuration. */
  config: SorobanResurrectConfig
  /** Called when the wallet is prompted to sign the restore transaction. */
  onSigningRestore?: () => void
  /** Called after restore transaction is signed and being submitted. */
  onSubmittingRestore?: () => void
  /** Called when archived entries are detected. */
  onRestoreNeeded?: (archivedKeys: ArchivedLedgerEntry[]) => void
  /** Called after the restore transaction is submitted. */
  onRestoreSubmitted?: (txHash: string) => void
  /** Called after the restore transaction is confirmed. */
  onRestoreConfirmed?: (txHash: string) => void
  /** Called after the original transaction is submitted. */
  onOriginalSubmitted?: (txHash: string) => void
  /** Called when the restore step of the workflow fails. */
  onRestoreFailed?: (error: string) => void
}

/**
 * Executes the full restore-and-submit workflow:
 *
 * 1. Simulate the original transaction.
 * 2. If simulation error → return error.
 * 3. If restore needed → extract archived keys, build restore tx,
 *    sign, submit, wait for confirmation.
 * 4. Rebuild original tx with fresh seq number, re-simulate, assemble.
 * 5. Sign and submit the original transaction.
 * 6. If simulation succeeds → sign and submit directly.
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
  } = params

  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
  const pollInterval = config.pollIntervalMs ?? POLL_INTERVAL_MS
  const pollTimeout = config.pollTimeoutMs ?? POLL_TIMEOUT_MS

  try {
    const simResponse = await server.simulateTransaction(originalTx)

    if (isErrorResponse(simResponse)) {
      const err = `Simulation error: ${simResponse.error}`
      onRestoreFailed?.(err)
      return {
        success: false,
        archivedKeysDetected: 0,
        error: err,
      }
    }

    if (isRestoreResponse(simResponse)) {
      const archivedKeys = extractArchivedKeys(simResponse)

      // Check wallet connection before attempting to get public key
      const isConnected = await wallet.isConnected()
      if (!isConnected) {
        const err = 'Wallet is not connected'
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          error: err,
        }
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
      const signedRestoreXdr = await wallet.signTransaction(restoreTx.toXDR(), {
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
      onRestoreSubmitted?.(restoreResult.hash)

      const restoreStatus = await waitForTransaction(
        server,
        restoreResult.hash,
        pollInterval,
        pollTimeout,
      )

      if (restoreStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        const err = 'Restore transaction failed'
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          restoreTxHash: restoreResult.hash,
          error: err,
        }
      }

      onRestoreConfirmed?.(restoreResult.hash)

      const preparedTx = await buildOriginalAfterRestore(
        server,
        originalTx,
        networkPassphrase,
        originalTx.fee,
      )

      onSigningOriginal?.()
      const signedOriginalXdr = await wallet.signTransaction(preparedTx.toXDR(), {
        networkPassphrase,
      })

      const signedOriginalTx = TransactionBuilder.fromXDR(signedOriginalXdr, networkPassphrase)
      if (!(signedOriginalTx instanceof Transaction)) {
        const err = 'Failed to parse signed original transaction'
        onRestoreFailed?.(err)
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          error: message,
        }
      }

      const originalResult = await server.sendTransaction(signedOriginalTx)
      onOriginalSubmitted?.(originalResult.hash)

      return {
        success: true,
        originalTxHash: originalResult.hash,
        restoreTxHash: restoreResult.hash,
        archivedKeysDetected: archivedKeys.length,
      }
    }

    if (isSuccessResponse(simResponse)) {
      onSigningOriginal?.()
      const signedTx = await wallet.signTransaction(originalTx.toXDR(), { networkPassphrase })
      const parsedTx = TransactionBuilder.fromXDR(signedTx, networkPassphrase)
      if (!(parsedTx instanceof Transaction)) {
        const err = 'Failed to parse signed transaction'
        return {
          success: false,
          archivedKeysDetected: 0,
          error: err,
        }
      }

      const sendResult = await server.sendTransaction(parsedTx)
      onOriginalSubmitted?.(sendResult.hash)

      // Wait for confirmation on success path for consistency with restore path
      const txStatus = await waitForTransaction(
        server,
        sendResult.hash,
        pollInterval,
        pollTimeout,
      )

      if (txStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          success: false,
          archivedKeysDetected: 0,
          error: 'Transaction failed to confirm',
        }
      }

      return {
        success: true,
        originalTxHash: sendResult.hash,
        archivedKeysDetected: 0,
      }
    }

    const err = 'Unexpected simulation response type'
    onRestoreFailed?.(err)
    return {
      success: false,
      archivedKeysDetected: 0,
      error: err,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    onRestoreFailed?.(message)
    return {
      success: false,
      archivedKeysDetected: 0,
      error: message,
    }
  }
}
