import { rpc, Transaction, xdr } from '@stellar/stellar-sdk'
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
import {
  DEFAULT_NETWORK_PASSPHRASE,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  RESTORE_FEE_MULTIPLIER,
  KNOWN_NETWORK_PASSPHRASES,
} from './constants.js'
import {
  queryLedgerTTL as _queryLedgerTTL,
  queryLedgerEntryTTL as _queryLedgerEntryTTL,
  getExpiringSoonEntries as _getExpiringSoonEntries,
  type LedgerEntryTTLInfo,
  type TTLQueryResult,
} from './TTLHelpers.js'

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
    const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE

    if (!KNOWN_NETWORK_PASSPHRASES.includes(networkPassphrase)) {
      console.warn(
        `Warning: Unknown network passphrase "${networkPassphrase}". ` +
          `Known networks: ${KNOWN_NETWORK_PASSPHRASES.join(', ')}. ` +
          `Transactions may fail with cryptic errors if the passphrase is incorrect.`,
      )
    }

    this.config = {
      rpcUrl: config.rpcUrl,
      networkPassphrase,
      pollIntervalMs: config.pollIntervalMs ?? POLL_INTERVAL_MS,
      pollTimeoutMs: config.pollTimeoutMs ?? POLL_TIMEOUT_MS,
      restoreFeeMultiplier: config.restoreFeeMultiplier ?? RESTORE_FEE_MULTIPLIER,
      archiveDetectionMethod: config.archiveDetectionMethod ?? 'simulation',
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
   * Detects archived ledger entries using the configured detection method.
   */
  async detectArchivedKeys(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    const method = this.config.archiveDetectionMethod ?? 'simulation'

    let keys: ArchivedLedgerEntry[] = []

    try {
      if (method === 'direct') {
        keys = await this.detectArchivedKeysViaDirect(transaction)
      } else {
        keys = await this.detectArchivedKeysViaSimulation(transaction)
      }
    } catch (err) {
      console.warn('SorobanResurrect: archive detection error:', err)
      keys = []
    }

    this._lastArchivedKeys = keys
    return keys
  }

  private async detectArchivedKeysViaSimulation(
    transaction: Transaction,
  ): Promise<ArchivedLedgerEntry[]> {
    const response = await this.simulate(transaction)
    if (isRestoreResponse(response)) {
      return extractArchivedKeys(response)
    }
    return []
  }

  private async detectArchivedKeysViaDirect(
    transaction: Transaction,
  ): Promise<ArchivedLedgerEntry[]> {
    const { detectArchivedKeysViaDirect: detect } = await import('./Archiver.js')
    return detect(this.server, transaction)
  }

  /**
   * Convenience method — returns true if the transaction requires
   * archive restoration before it can be submitted.
   */
  needsRestore(transaction: Transaction): Promise<boolean> {
    return this.detectArchivedKeys(transaction).then((keys) => keys.length > 0)
  }

  /**
   * Builds a restore transaction for the given source account and transaction.
   */
  async buildRestoreTx(
    sourcePublicKey: string,
    transaction: Transaction,
    simulationResponse?: rpc.Api.SimulateTransactionRestoreResponse,
  ) {
    const response = simulationResponse ?? (await this.simulate(transaction))

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

  // ---------------------------------------------------------------------------
  // TTL / expiry helpers
  // ---------------------------------------------------------------------------

  /**
   * Queries the current TTL information for one or more ledger keys.
   *
   * Uses the Soroban RPC `getLedgerEntries` and `getLatestLedger` calls to
   * determine how many ledgers remain until each entry expires. Keys not found
   * on-chain are reported as archived.
   *
   * @param keys - Ledger keys to query.
   * @returns Aggregated TTL result with per-entry info and query metadata.
   *
   * @example
   * ```ts
   * const result = await resurrect.queryLedgerTTL([ledgerKey])
   * console.log(result.entries[0].ttlLedgers) // ledgers remaining
   * ```
   */
  async queryLedgerTTL(keys: xdr.LedgerKey[]): Promise<TTLQueryResult> {
    return _queryLedgerTTL(this.server, keys)
  }

  /**
   * Queries the current TTL information for a single ledger key.
   *
   * @param key - The ledger key to query.
   * @returns TTL info for the requested entry.
   *
   * @example
   * ```ts
   * const info = await resurrect.queryLedgerEntryTTL(ledgerKey)
   * if (info.ttlLedgers < 10_000) {
   *   console.warn('Entry expiring soon!')
   * }
   * ```
   */
  async queryLedgerEntryTTL(key: xdr.LedgerKey): Promise<LedgerEntryTTLInfo> {
    return _queryLedgerEntryTTL(this.server, key)
  }

  /**
   * Returns ledger entries that are expiring within `ledgersThreshold` ledgers,
   * including entries that are already archived.
   *
   * Useful for proactively warning users before their on-chain data expires so
   * they can extend TTL before a transaction fails.
   *
   * @param keys              - Ledger keys to query.
   * @param ledgersThreshold  - Maximum ledgers remaining to be considered "expiring soon"
   *                            (defaults to 100,000 ledgers ≈ ~5.8 days at 5 s/ledger).
   * @returns Entries expiring within the threshold (or already archived).
   *
   * @example
   * ```ts
   * const expiring = await resurrect.getExpiringSoonEntries([key], 17_280) // ~24 h
   * if (expiring.length > 0) {
   *   showWarning('Your position is expiring soon!')
   * }
   * ```
   */
  async getExpiringSoonEntries(
    keys: xdr.LedgerKey[],
    ledgersThreshold = 100_000,
  ): Promise<LedgerEntryTTLInfo[]> {
    return _getExpiringSoonEntries(this.server, keys, ledgersThreshold)
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
    const {
      transaction,
      wallet,
      onRestoreFailed,
      onSigningRestore,
      onSubmittingRestore,
      onSigningOriginal,
      ...callbacks
    } = options

    const result = await executeWithRestore({
      server: this.server,
      transaction,
      wallet,
      config: this.config,
      onSigningRestore: () => {
        this.setState('signing_restore', 'Awaiting wallet signature for restore transaction...')
        onSigningRestore?.()
      },
      onSubmittingRestore: () => {
        this.setState('submitting_restore', 'Submitting restore transaction...')
        onSubmittingRestore?.()
      },
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
        this.setState('submitting_original', 'Restore confirmed. Preparing original transaction...')
        callbacks.onRestoreConfirmed?.(txHash)
      },
      onSigningOriginal: () => {
        this.setState('signing_original', 'Signing original transaction...')
        onSigningOriginal?.()
      },
      onOriginalSubmitted: (txHash) => {
        this.setState('success', 'Original transaction submitted successfully')
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
