import { rpc, Transaction, xdr } from '@stellar/stellar-sdk'
import {
  ArchivedLedgerEntry,
  ResurrectResult,
  SorobanResurrectConfig,
  SubmitWithRestoreOptions,
  WalletAdapter,
} from './types.js'
import {
  executeWithRestore,
  sendTransaction as _sendTransaction,
  restoreKeys as _restoreKeys,
} from './Executor.js'
import { buildRestoreTransaction } from './Restorer.js'
import { isRestoreResponse } from './Archiver.js'
import { TransactionHistory, TransactionHistoryEntry } from './TransactionHistory.js'
import { SorobanResurrectStateManager } from './SorobanResurrectState.js'
import { SorobanResurrectSimulator } from './SorobanResurrectSimulation.js'

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
  private readonly _server: rpc.Server
  private readonly _config: Required<SorobanResurrectConfig>
  private readonly _stateMgr: SorobanResurrectStateManager
  private readonly _simulator: SorobanResurrectSimulator
  private readonly _history = new TransactionHistory()

  /**
   * @param server    - Soroban RPC server instance.
   * @param config    - Fully resolved SDK configuration.
   * @param stateMgr  - Shared state manager for state transitions and events.
   * @param simulator - Simulation/detection helper for the same instance.
   */
  constructor(
    server: rpc.Server,
    config: Required<SorobanResurrectConfig>,
    stateMgr: SorobanResurrectStateManager,
    simulator: SorobanResurrectSimulator,
  ) {
    this._server = server
    this._config = config
    this._stateMgr = stateMgr
    this._simulator = simulator
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

    const result = await executeWithRestore({
      server: this._server,
      transaction,
      wallet,
      config: this._config,

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

      onRestoreSubmitted: (txHash: string) => {
        stateMgr.setState('confirming_restore', 'Waiting for restore confirmation...')
        emitter.emit('restoreSubmitted', txHash)
        onRestoreSubmitted?.(txHash)
      },

      onRestoreConfirmed: (txHash: string) => {
        stateMgr.setState(
          'submitting_original',
          'Restore confirmed. Preparing original transaction...',
        )
        emitter.emit('restoreConfirmed', txHash)
        onRestoreConfirmed?.(txHash)
      },

      onSigningOriginal: () => {
        stateMgr.setState('signing_original', 'Signing original transaction...')
        onSigningOriginal?.()
      },

      onOriginalSubmitted: (txHash: string) => {
        stateMgr.setState('success', 'Original transaction submitted successfully')
        emitter.emit('originalSubmitted', txHash)
        onOriginalSubmitted?.(txHash)
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
    const entry = this._history.get(entryId)
    if (!entry) {
      throw new Error(`No history entry found for id: ${entryId}`)
    }

    this._history.incrementAttempt(entryId)

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

    this._history.update(entryId, result)

    if (!result.success) {
      stateMgr.setError(result.error ?? 'Unknown error')
    }

    return result
  }

  /**
   * Submits multiple transactions sequentially with automatic restore.
   * Sequential execution avoids sequence-number races for shared source accounts.
   * A failure on one transaction does not stop processing of the remaining ones.
   *
   * @param items - Array of `SubmitWithRestoreOptions`, one per transaction.
   * @returns Array of results in the same order as the input.
   */
  async submitBatchWithRestore(items: SubmitWithRestoreOptions[]): Promise<ResurrectResult[]> {
    const results: ResurrectResult[] = []
    for (const item of items) {
      results.push(await this.submitWithRestore(item))
    }
    return results
  }
}
