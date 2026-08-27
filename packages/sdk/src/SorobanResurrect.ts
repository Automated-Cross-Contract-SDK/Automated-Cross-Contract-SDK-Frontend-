import { rpc, Transaction, xdr } from '@stellar/stellar-sdk'
import {
  SorobanResurrectConfig,
  RestoreState,
  RestoreStateInfo,
  ArchivedLedgerEntry,
  ResurrectResult,
  SubmitWithRestoreOptions,
  SorobanResurrectEvents,
  WalletAdapter,
} from './types.js'
import { executeWithRestore, sendTransaction } from './Executor.js'
import { isRestoreResponse, extractArchivedKeys } from './Archiver.js'
import { buildRestoreTransaction } from './Restorer.js'
import {
  DEFAULT_NETWORK_PASSPHRASE,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  RESTORE_FEE_MULTIPLIER,
  KNOWN_NETWORK_PASSPHRASES,
  resolveNetworkPassphrase,
} from './constants.js'
import { TypedEventEmitter } from './EventEmitter.js'
import { SimulationCache } from './SimulationCache.js'
import { TransactionHistory, TransactionHistoryEntry } from './TransactionHistory.js'
import { TTLQueryResult, LedgerEntryTTLInfo } from './TTLHelpers.js'
import {
  queryLedgerTTL as _queryLedgerTTL,
  queryLedgerEntryTTL as _queryLedgerEntryTTL,
  getExpiringSoonEntries as _getExpiringSoonEntries,
} from './TTLHelpers.js'
import {
  createRestoreService,
  toRestoreStateInfo,
  type RestoreService,
} from './RestoreMachine.js'

/**
 * Main facade for the Soroban-Resurrect SDK.
 *
 * Provides a high-level API for detecting archived ledger entries,
 * building restore transactions, and submitting transactions with
 * automatic archive restoration. State changes are published to
 * registered listeners via the observer pattern.
 *
 * Internally, workflow state is managed by an `@xstate/fsm` finite state
 * machine (see `RestoreMachine.ts`). This replaces the former manual
 * `_state`/`_message` variables and imperative `setState()` calls with
 * explicit, declarative state transitions that are easier to reason about,
 * test in isolation, and visualise.
 *
 * @see {@link SorobanResurrectConfig} for constructor options.
 * @see {@link onStateChange} to subscribe to workflow state transitions.
 *
 * @example
 * ```ts
 * const resurrect = new SorobanResurrect({ rpcUrl: 'https://...' })
 * const result = await resurrect.submitWithRestore({ transaction, wallet })
 * // result.historyId can be used to retry via resurrect.retry(result.historyId, wallet)
 * ```
 */
export class SorobanResurrect {
  /** Soroban RPC server instance. */
  public readonly server: rpc.Server
  /** Resolved configuration with defaults applied. */
  public readonly config: Required<SorobanResurrectConfig>

  // ---------------------------------------------------------------------------
  // State machine (replaces former _state / _message / _lastError /
  // _lastArchivedKeys private fields and the imperative setState() method)
  // ---------------------------------------------------------------------------
  private _service: RestoreService

  // Legacy observer-pattern listeners (kept for backward compatibility with
  // the public onStateChange() API).
  private _listeners: Array<(info: RestoreStateInfo) => void> = []
  private _emitter = new TypedEventEmitter<SorobanResurrectEvents>()

  // Optional simulation cache (enabled via config.enableSimulationCache).
  private _simulationCache: SimulationCache | undefined

  // Transaction history log.
  private _history = new TransactionHistory()

  // Last set of archived keys from a standalone detectArchivedKeys() call.
  // The FSM context already stores archivedKeys for the full submit workflow;
  // this field covers the standalone diagnostic path so stateInfo.archivedKeys
  // is always populated regardless of which code path populated it.
  private _standaloneArchivedKeys: ArchivedLedgerEntry[] = []

  /**
   * Creates a new SDK instance bound to a single Soroban RPC endpoint.
   *
   * @param config - SDK configuration. Only `rpcUrl` is required; all
   *   other fields fall back to sensible Testnet defaults.
   *
   * @example
   * ```ts
   * const resurrect = new SorobanResurrect({
   *   rpcUrl: 'https://soroban-testnet.stellar.org',
   *   networkPassphrase: Networks.TESTNET,
   * })
   * ```
   */
  constructor(config: SorobanResurrectConfig) {
    this.server = new rpc.Server(config.rpcUrl)

    const networkPassphrase =
      config.networkPassphrase ??
      resolveNetworkPassphrase(config.rpcUrl) ??
      DEFAULT_NETWORK_PASSPHRASE

    // Validate network passphrase against known networks.
    if (!KNOWN_NETWORK_PASSPHRASES.includes(networkPassphrase)) {
      const knownNetworks = KNOWN_NETWORK_PASSPHRASES.map((p) => `"${p}"`).join(', ')
      throw new Error(
        `Invalid network passphrase: "${networkPassphrase}". ` +
          `Must be one of: ${knownNetworks}. ` +
          `A typo in the passphrase will cause cryptic transaction failures.`,
      )
    }

    if (config.enableSimulationCache) {
      this._simulationCache = new SimulationCache()
    }

    this.config = {
      rpcUrl: config.rpcUrl,
      networkPassphrase,
      pollIntervalMs: config.pollIntervalMs ?? POLL_INTERVAL_MS,
      pollTimeoutMs: config.pollTimeoutMs ?? POLL_TIMEOUT_MS,
      restoreFeeMultiplier: config.restoreFeeMultiplier ?? RESTORE_FEE_MULTIPLIER,
      archiveDetectionMethod: config.archiveDetectionMethod ?? 'simulation',
      enableSimulationCache: config.enableSimulationCache ?? false,
      useSSE: config.useSSE ?? false,
    } as Required<SorobanResurrectConfig>

    // Start the state machine service and wire its state transitions to the
    // existing observer-pattern listeners and typed event emitter.
    this._service = createRestoreService()
    this._service.subscribe((machineState) => {
      const info = toRestoreStateInfo(
        String(machineState.value),
        machineState.context,
      )
      for (const listener of this._listeners) {
        try {
          listener(info)
        } catch (err) {
          console.warn('SorobanResurrect: state listener error:', err)
        }
      }
      this._emitter.emit('stateChange', info)
    })
  }

  // ---------------------------------------------------------------------------
  // Public state accessors
  // ---------------------------------------------------------------------------

  /** Current workflow state. */
  get state(): RestoreState {
    return this._service.state.value as RestoreState
  }

  /** Snapshot of current state, message, archived keys, and error. */
  get stateInfo(): RestoreStateInfo {
    const info = toRestoreStateInfo(
      String(this._service.state.value),
      this._service.state.context,
    )
    // Merge standalone archivedKeys (from direct detectArchivedKeys calls)
    // so the field is always populated regardless of the code path.
    if (!info.archivedKeys || info.archivedKeys.length === 0) {
      info.archivedKeys = this._standaloneArchivedKeys
    }
    return info
  }

  // ---------------------------------------------------------------------------
  // Transaction history
  // ---------------------------------------------------------------------------

  /**
   * All recorded history entries in insertion order.
   * Each `submitWithRestore` call (including retries) appends an entry.
   */
  get history(): TransactionHistoryEntry[] {
    return this._history.getAll()
  }

  /**
   * Returns all recorded history entries in insertion order.
   * Equivalent to reading the `history` property.
   */
  getHistory(): TransactionHistoryEntry[] {
    return this._history.getAll()
  }

  /**
   * Clears all recorded history entries.
   */
  clearHistory(): void {
    this._history.clear()
  }

  // ---------------------------------------------------------------------------
  // Retry
  // ---------------------------------------------------------------------------

  /**
   * Retries a previously-recorded restore workflow without re-building the
   * original transaction.
   *
   * @param entryId - The id returned in `submitWithRestore`'s `historyId` field.
   * @param wallet  - The wallet adapter to use for signing.
   * @returns The result of the retry attempt.
   * @throws If no history entry is found for `entryId`.
   */
  async retry(entryId: string, wallet: WalletAdapter): Promise<ResurrectResult> {
    const entry = this._history.get(entryId)
    if (!entry) {
      throw new Error(`No history entry found for id: ${entryId}`)
    }

    this._history.incrementAttempt(entryId)

    const result = await executeWithRestore({
      server: this.server,
      transaction: entry.transaction,
      wallet,
      config: this.config,
      onSigningRestore: () => {
        this._service.send({ type: 'SIGN_RESTORE' })
      },
      onSubmittingRestore: () => {
        this._service.send({ type: 'SUBMIT_RESTORE' })
      },
      onRestoreNeeded: (keys) => {
        this._service.send({ type: 'RESTORE_NEEDED', keys })
        this._emitter.emit('restoreNeeded', keys)
      },
      onRestoreSubmitted: (txHash) => {
        this._service.send({ type: 'CONFIRM_RESTORE' })
        this._emitter.emit('restoreSubmitted', txHash)
      },
      onRestoreConfirmed: (txHash) => {
        this._service.send({ type: 'SIGN_ORIGINAL' })
        this._emitter.emit('restoreConfirmed', txHash)
      },
      onSigningOriginal: () => {
        // Already in signing_original — no FSM transition needed.
      },
      onOriginalSubmitted: (txHash) => {
        this._service.send({ type: 'SUCCESS' })
        this._emitter.emit('originalSubmitted', txHash)
      },
    })

    this._history.update(entryId, result)

    if (!result.success) {
      this._service.send({ type: 'FAIL', error: result.error ?? 'Unknown error' })
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Observer / event API
  // ---------------------------------------------------------------------------

  /**
   * Registers a listener for state changes. Returns an unsubscribe function.
   *
   * @param listener - Callback invoked with a {@link RestoreStateInfo}
   *   snapshot on every state transition.
   * @returns Function that removes the listener when called.
   *
   * @example
   * ```ts
   * const unsubscribe = resurrect.onStateChange((info) => {
   *   console.log(info.state, info.message)
   * })
   * unsubscribe()
   * ```
   */
  onStateChange(listener: (info: RestoreStateInfo) => void): () => void {
    this._listeners.push(listener)
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener)
    }
  }

  /**
   * Registers a listener for a specific typed event (e.g. `restoreComplete`,
   * `originalSubmitted`, `error`). Returns a function that removes it.
   */
  on<K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ): () => void {
    return this._emitter.on(event, listener)
  }

  /** Registers a listener that fires at most once for the given event. */
  once<K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ): () => void {
    return this._emitter.once(event, listener)
  }

  /** Removes a previously registered listener for the given event. */
  off<K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ): void {
    this._emitter.off(event, listener)
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  /**
   * Resets the instance back to idle state, clearing any archived keys
   * and error messages from previous workflows.
   *
   * @param fromState - When provided, only resets if the current state
   *   matches this value (guarded reset).
   *
   * @example
   * ```ts
   * resurrect.reset()
   * console.log(resurrect.state) // 'idle'
   * ```
   */
  reset(fromState?: RestoreState): void {
    if (fromState !== undefined && this.state !== fromState) return
    this._standaloneArchivedKeys = []
    this._service.send({ type: 'RESET' })
  }

  // ---------------------------------------------------------------------------
  // Core workflow
  // ---------------------------------------------------------------------------

  /**
   * Simulates a transaction on the Soroban RPC endpoint.
   * Transitions internal state to `'simulating'`.
   *
   * @param transaction - The transaction to simulate.
   * @returns The raw simulation response from the RPC server.
   */
  async simulate(transaction: Transaction) {
    this._service.send({ type: 'SIMULATE' })

    if (this._simulationCache) {
      const cached = this._simulationCache.get(transaction)
      if (cached) {
        return cached
      }
    }

    const response = await this.server.simulateTransaction(transaction)

    if (this._simulationCache) {
      this._simulationCache.set(transaction, response)
    }

    return response
  }

  /**
   * Detects archived ledger entries using the configured detection method.
   * Returns the list of archived keys, or an empty array if none.
   *
   * Detection errors are caught internally and treated as "no archived
   * keys found" — this method never throws.
   *
   * @param transaction - The transaction whose footprint should be checked.
   * @returns Array of {@link ArchivedLedgerEntry} — empty if nothing is
   *   archived or detection failed.
   */
  async detectArchivedKeys(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    const method = this.config.archiveDetectionMethod ?? 'simulation'
    let keys: ArchivedLedgerEntry[] = []

    try {
      if (method === 'direct') {
        keys = await this._detectArchivedKeysViaDirect(transaction)
      } else {
        keys = await this._detectArchivedKeysViaSimulation(transaction)
      }
    } catch (err) {
      console.warn('SorobanResurrect: archive detection error:', err)
      keys = []
    }

    // Store for stateInfo.archivedKeys (standalone path — the full submit
    // workflow populates FSM context directly via the RESTORE_NEEDED event).
    this._standaloneArchivedKeys = keys
    return keys
  }

  private async _detectArchivedKeysViaSimulation(
    transaction: Transaction,
  ): Promise<ArchivedLedgerEntry[]> {
    const response = await this.simulate(transaction)
    if (isRestoreResponse(response)) {
      return extractArchivedKeys(response)
    }
    return []
  }

  private async _detectArchivedKeysViaDirect(
    transaction: Transaction,
  ): Promise<ArchivedLedgerEntry[]> {
    const { detectArchivedKeysViaDirect: detect } = await import('./Archiver.js')
    return detect(this.server, transaction)
  }

  /**
   * Convenience method — returns true if the transaction requires
   * archive restoration before it can be submitted.
   *
   * @param transaction - The transaction to check.
   * @returns `true` if one or more archived ledger entries were detected.
   */
  needsRestore(transaction: Transaction): Promise<boolean> {
    return this.detectArchivedKeys(transaction).then((keys) => keys.length > 0)
  }

  /**
   * Builds a restore transaction for the given source account and transaction.
   *
   * If `simulationResponse` is provided it is used directly (no RPC call,
   * no state transition). Otherwise the transaction is simulated first.
   *
   * @throws {Error} If the simulation does not indicate a restore is needed.
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

  /**
   * Submits a transaction with automatic archive restoration.
   *
   * Records the attempt in transaction history. The returned result includes
   * a `historyId` field that can be passed to `retry()` to re-attempt a
   * failed workflow.
   *
   * This method never throws — all failures are caught and returned as a
   * {@link ResurrectResult} with `success: false` and an `error` message.
   *
   * @param options - See {@link SubmitWithRestoreOptions}.
   * @returns A {@link ResurrectResult} describing the outcome.
   *
   * @example
   * ```ts
   * const result = await resurrect.submitWithRestore({ transaction: tx, wallet })
   * if (result.success) {
   *   console.log('Submitted:', result.originalTxHash)
   * } else {
   *   console.error('Failed:', result.error)
   * }
   * ```
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

    // Transition the machine out of idle before the executor runs so that
    // any state-change listener registered via onStateChange() fires at
    // least once and the current state is never 'idle' during an active workflow.
    this._service.send({ type: 'SIMULATE' })

    const result = await executeWithRestore({
      server: this.server,
      transaction,
      wallet,
      config: this.config,
      onSigningRestore: () => {
        this._service.send({ type: 'SIGN_RESTORE' })
        onSigningRestore?.()
      },
      onSubmittingRestore: () => {
        this._service.send({ type: 'SUBMIT_RESTORE' })
        onSubmittingRestore?.()
      },
      onRestoreNeeded: (keys) => {
        this._service.send({ type: 'RESTORE_NEEDED', keys })
        this._emitter.emit('restoreNeeded', keys)
        onRestoreNeeded?.(keys)
      },
      onRestoreSubmitted: (txHash) => {
        this._service.send({ type: 'CONFIRM_RESTORE' })
        this._emitter.emit('restoreSubmitted', txHash)
        onRestoreSubmitted?.(txHash)
      },
      onRestoreConfirmed: (txHash) => {
        this._service.send({ type: 'SIGN_ORIGINAL' })
        this._emitter.emit('restoreConfirmed', txHash)
        onRestoreConfirmed?.(txHash)
      },
      onSigningOriginal: () => {
        // Already in signing_original state (reached via NO_RESTORE_NEEDED or
        // SIGN_ORIGINAL from confirming_restore). No further FSM send needed.
        onSigningOriginal?.()
      },
      onOriginalSubmitted: (txHash) => {
        this._service.send({ type: 'SUCCESS' })
        this._emitter.emit('originalSubmitted', txHash)
        onOriginalSubmitted?.(txHash)
      },
      onRestoreFailed: (error) => {
        this._emitter.emit('error', error)
        onRestoreFailed?.(error)
      },
      onSigningFeeBump: () => {
        // Fee-bump signing reuses the signing_restore state visually.
        this._service.send({ type: 'SIGN_RESTORE' })
      },
    })

    this._history.update(historyId, result)

    if (!result.success) {
      this._service.send({ type: 'FAIL', error: result.error ?? 'Unknown error' })
      this._emitter.emit('error', result.error ?? 'Unknown error')
    }

    this._emitter.emit('restoreComplete', result)

    return result
  }

  // ---------------------------------------------------------------------------
  // Batch helpers
  // ---------------------------------------------------------------------------

  /**
   * Detects archived ledger entries across multiple transactions at once.
   */
  async detectArchivedKeysBatch(transactions: Transaction[]): Promise<ArchivedLedgerEntry[][]> {
    return Promise.all(transactions.map((tx) => this.detectArchivedKeys(tx)))
  }

  /**
   * Submits multiple transactions with automatic archive restoration,
   * sequentially to avoid sequence-number races.
   */
  async submitBatchWithRestore(items: SubmitWithRestoreOptions[]): Promise<ResurrectResult[]> {
    const results: ResurrectResult[] = []
    for (const item of items) {
      results.push(await this.submitWithRestore(item))
    }
    return results
  }

  // ---------------------------------------------------------------------------
  // Direct send (no restore)
  // ---------------------------------------------------------------------------

  /**
   * Signs and submits a transaction directly, without automatic archive
   * restoration. Use `submitWithRestore` for the full workflow.
   */
  async sendTransaction(
    transaction: Transaction,
    wallet: WalletAdapter,
  ): Promise<ResurrectResult> {
    return sendTransaction(this.server, transaction, wallet, this.config)
  }

  // ---------------------------------------------------------------------------
  // TTL / expiry helpers
  // ---------------------------------------------------------------------------

  /**
   * Queries the current TTL information for one or more ledger keys.
   *
   * @param keys - Ledger keys to query.
   * @returns Aggregated TTL result with per-entry info and query metadata.
   */
  async queryLedgerTTL(keys: xdr.LedgerKey[]): Promise<TTLQueryResult> {
    return _queryLedgerTTL(this.server, keys)
  }

  /**
   * Queries the current TTL information for a single ledger key.
   *
   * @param key - The ledger key to query.
   * @returns TTL info for the requested entry.
   */
  async queryLedgerEntryTTL(key: xdr.LedgerKey): Promise<LedgerEntryTTLInfo> {
    return _queryLedgerEntryTTL(this.server, key)
  }

  /**
   * Returns ledger entries that are expiring within `ledgersThreshold` ledgers,
   * including entries that are already archived.
   *
   * @param keys              - Ledger keys to query.
   * @param ledgersThreshold  - Maximum ledgers remaining to be considered
   *   "expiring soon" (defaults to 100,000 ≈ ~5.8 days at 5 s/ledger).
   * @returns Entries expiring within the threshold (or already archived).
   */
  async getExpiringSoonEntries(
    keys: xdr.LedgerKey[],
    ledgersThreshold = 100_000,
  ): Promise<LedgerEntryTTLInfo[]> {
    return _getExpiringSoonEntries(this.server, keys, ledgersThreshold)
  }
}
