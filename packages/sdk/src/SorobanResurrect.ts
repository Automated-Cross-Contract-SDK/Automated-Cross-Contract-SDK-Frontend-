import { rpc, Transaction } from '@stellar/stellar-sdk'
import {
  SorobanResurrectConfig,
  RestoreState,
  RestoreStateInfo,
  ArchivedLedgerEntry,
  ResurrectResult,
  SubmitWithRestoreOptions,
} from './types.js'
import { executeWithRestore } from './Executor.js'
import { isRestoreResponse, extractArchivedKeys } from './Archiver.js'
import { buildRestoreTransaction } from './Restorer.js'
import { DEFAULT_NETWORK_PASSPHRASE, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from './constants.js'

/**
 * Main facade for the Soroban-Resurrect SDK.
 *
 * Provides a high-level API for detecting archived ledger entries,
 * building restore transactions, and submitting transactions with
 * automatic archive restoration. State changes are published to
 * registered listeners via the observer pattern.
 *
 * @example
 * ```ts
 * const resurrec = new SorobanResurrect({ rpcUrl: 'https://...' })
 * const result = await resurrec.submitWithRestore({ transaction, wallet })
 * ```
 */
export class SorobanResurrect {
  /** Soroban RPC server instance. */
  public readonly server: rpc.Server
  /** Resolved configuration with defaults applied. */
  public readonly config: Required<SorobanResurrectConfig>

  private _state: RestoreState = 'idle'
  private _message: string = ''
  private _lastError: string | undefined
  private _lastArchivedKeys: ArchivedLedgerEntry[] = []
  private _listeners: Array<(info: RestoreStateInfo) => void> = []

  constructor(config: SorobanResurrectConfig) {
    this.server = new rpc.Server(config.rpcUrl)
    this.config = {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE,
      pollIntervalMs: config.pollIntervalMs ?? POLL_INTERVAL_MS,
      pollTimeoutMs: config.pollTimeoutMs ?? POLL_TIMEOUT_MS,
    }
  }

  /** Current workflow state. */
  get state(): RestoreState {
    return this._state
  }

  /** Snapshot of current state, message, archived keys, and error. */
  get stateInfo(): RestoreStateInfo {
    return {
      state: this._state,
      message: this._message,
      archivedKeys: this._lastArchivedKeys,
      error: this._lastError,
    }
  }

  /**
   * Registers a listener for state changes. Returns an unsubscribe function.
   *
   * @param listener - Callback invoked on every state transition.
   * @returns Function that removes the listener when called.
   */
  onStateChange(listener: (info: RestoreStateInfo) => void): () => void {
    this._listeners.push(listener)
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener)
    }
  }

  private emitState() {
    const info = this.stateInfo
    for (const listener of this._listeners) {
      try {
        listener(info)
      } catch (err) {
        console.warn('SorobanResurrect: state listener error:', err)
      }
    }
  }

  private setState(state: RestoreState, message: string) {
    this._state = state
    this._message = message
    if (state !== 'error') {
      this._lastError = undefined
    }
    if (state === 'simulating' || state === 'idle') {
      this._lastArchivedKeys = []
    }
    this.emitState()
  }

  /**
   * Resets the instance back to idle state, clearing any archived keys
   * and error messages from previous workflows.
   */
  reset() {
    this._lastError = undefined
    this._lastArchivedKeys = []
    this.setState('idle', '')
  }

  /**
   * Simulates a transaction on the Soroban RPC endpoint.
   * Updates internal state to 'simulating'.
   */
  async simulate(transaction: Transaction) {
    this.setState('simulating', 'Simulating transaction...')
    const response = await this.server.simulateTransaction(transaction)
    return response
  }

  /**
   * Detects archived ledger entries by simulating the transaction.
   * Returns the list of archived keys, or an empty array if none.
   */
  async detectArchivedKeys(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    const response = await this.simulate(transaction)

    if (isRestoreResponse(response)) {
      const keys = extractArchivedKeys(response)
      this._lastArchivedKeys = keys
      return keys
    }

    this._lastArchivedKeys = []
    return []
  }

  /**
   * Convenience method — returns true if the transaction requires
   * archive restoration before it can be submitted.
   */
  needsRestore(transaction: Transaction): Promise<boolean> {
    return this.detectArchivedKeys(transaction).then((keys) => keys.length > 0)
  }

  /**
   * Builds a restore transaction for the given source account and
   * transaction. Throws if the simulation does not indicate a
   * restore is needed.
   */
  async buildRestoreTx(sourcePublicKey: string, transaction: Transaction) {
    const response = await this.simulate(transaction)

    if (!isRestoreResponse(response)) {
      throw new Error('No archived keys detected — restore transaction not needed')
    }

    return buildRestoreTransaction({
      server: this.server,
      sourcePublicKey,
      transactionData: response.transactionData.build(),
      minResourceFee: parseInt(response.minResourceFee, 10),
      config: this.config,
    })
  }

  /**
   * Submits a transaction with automatic archive restoration.
   *
   * If the simulation detects archived entries, a restore transaction
   * is built, signed, submitted, and confirmed before the original
   * transaction is rebuilt and submitted. State transitions are
   * published to all registered listeners.
   */
  async submitWithRestore(options: SubmitWithRestoreOptions): Promise<ResurrectResult> {
    const { transaction, wallet, onRestoreFailed, ...callbacks } = options

    const result = await executeWithRestore({
      server: this.server,
      transaction,
      wallet,
      config: this.config,
      onRestoreNeeded: (keys) => {
        this._lastArchivedKeys = keys
        this.setState('restore_needed', `Detected ${keys.length} archived ledger entries`)
        callbacks.onRestoreNeeded?.(keys)
      },
      onRestoreSubmitted: (txHash) => {
        this.setState('confirming_restore', 'Waiting for restore confirmation...')
        callbacks.onRestoreSubmitted?.(txHash)
      },
      onRestoreConfirmed: (txHash) => {
        this.setState(
          'submitting_original',
          'Restore confirmed. Submitting original transaction...',
        )
        callbacks.onRestoreConfirmed?.(txHash)
      },
      onOriginalSubmitted: (txHash) => {
        this.setState('success', 'Transaction submitted successfully')
        callbacks.onOriginalSubmitted?.(txHash)
      },
      onRestoreFailed: (error) => {
        onRestoreFailed?.(error)
      },
    })

    if (!result.success) {
      this._lastError = result.error
      this.setState('error', result.error ?? 'Unknown error')
    }

    return result
  }
}
