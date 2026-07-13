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
  } = params

  const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
  const pollInterval = config.pollIntervalMs ?? POLL_INTERVAL_MS
  const pollTimeout = config.pollTimeoutMs ?? POLL_TIMEOUT_MS

  try {
    const simResponse = await server.simulateTransaction(originalTx)

    if (isErrorResponse(simResponse)) {
      return {
        success: false,
        archivedKeysDetected: 0,
        error: `Simulation error: ${simResponse.error}`,
      }
    }

    if (isRestoreResponse(simResponse)) {
      const archivedKeys = extractArchivedKeys(simResponse)
      onRestoreNeeded?.(archivedKeys)

      if (!(await wallet.isConnected())) {
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

      const signedOriginalXdr = await wallet.signTransaction(preparedTx.toXDR(), {
        networkPassphrase,
      })

      const signedOriginalTx = TransactionBuilder.fromXDR(signedOriginalXdr, networkPassphrase)
      if (!(signedOriginalTx instanceof Transaction)) {
        return {
          success: false,
          archivedKeysDetected: archivedKeys.length,
          restoreTxHash: restoreResult.hash,
          error: 'Failed to parse signed original transaction',
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
      const signedTx = await wallet.signTransaction(originalTx.toXDR(), { networkPassphrase })
      const parsedTx = TransactionBuilder.fromXDR(signedTx, networkPassphrase)
      if (!(parsedTx instanceof Transaction)) {
        return {
          success: false,
          archivedKeysDetected: 0,
          error: 'Failed to parse signed transaction',
        }
      }

      const sendResult = await server.sendTransaction(parsedTx)
      onOriginalSubmitted?.(sendResult.hash)

      return {
        success: true,
        originalTxHash: sendResult.hash,
        archivedKeysDetected: 0,
      }
    }

    return {
      success: false,
      archivedKeysDetected: 0,
      error: 'Unexpected simulation response type',
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
