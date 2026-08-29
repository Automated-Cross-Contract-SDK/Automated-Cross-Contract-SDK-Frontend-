import { rpc, Transaction, xdr } from '@stellar/stellar-sdk'
import type {
  SorobanResurrectConfig,
  WalletAdapter,
  RestoreState,
  RestoreStateInfo,
  ArchivedLedgerEntry,
  ResurrectResult,
  SubmitWithRestoreOptions,
  SorobanResurrectEvents,
  RestoreKeysOptions,
} from './types.js'
import { resolveConfig, type ResolvedSorobanResurrectConfig } from './SorobanResurrectConfig.js'
import { SorobanResurrectStateManager } from './SorobanResurrectState.js'
import { SorobanResurrectSimulator } from './SorobanResurrectSimulation.js'
import { SorobanResurrectExecutor } from './SorobanResurrectExecution.js'
import type { TransactionHistoryEntry } from './TransactionHistory.js'
import { queryLedgerTTL, queryLedgerEntryTTL, getExpiringSoonEntries } from './TTLHelpers.js'
import type { LedgerEntryTTLInfo, TTLQueryResult } from './TTLHelpers.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import type { StellarPublicKey } from './branded-types.js'

/**
 * Main facade for the Soroban-Resurrect SDK.
 *
 * Provides a high-level API for detecting archived ledger entries,
 * building restore transactions, and submitting transactions with
 * automatic archive restoration. State changes are published to
 * registered listeners via the observer pattern.
 *
 * Internally the class delegates every concern to a focused module:
 * - **Config / init** → {@link resolveConfig} (`SorobanResurrectConfig.ts`)
 * - **State & events** → `SorobanResurrectStateManager` (`SorobanResurrectState.ts`)
 * - **Simulation & detection** → `SorobanResurrectSimulator` (`SorobanResurrectSimulation.ts`)
 * - **Execution & history** → `SorobanResurrectExecutor` (`SorobanResurrectExecution.ts`)
 * - **TTL helpers** → functions in `TTLHelpers.ts`
 *
 * @see {@link SorobanResurrectConfig} for constructor options.
 * @see {@link onStateChange} to subscribe to workflow state transitions.
 *
 * @example
 * ```ts
 * const resurrect = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })
 * const result = await resurrect.submitWithRestore({ transaction, wallet })
 * // result.historyId can be used to retry via resurrect.retry(result.historyId, wallet)
 * ```
 */
export class SorobanResurrect {
  /**
   * The RPC client used for all Soroban network calls.
   *
   * Exposes the {@link ISorobanRpcClient} interface rather than the
   * concrete `rpc.Server` class, making it possible to inject test
   * doubles via `config.rpcClient` without casting.
   */
  public readonly server: ISorobanRpcClient
  /** Resolved configuration with defaults applied. */
  public readonly config: ResolvedSorobanResurrectConfig

  private readonly _stateMgr: SorobanResurrectStateManager
  private readonly _simulator: SorobanResurrectSimulator
  private readonly _executor: SorobanResurrectExecutor

  /**
   * Creates a new SDK instance bound to a single Soroban RPC endpoint.
   *
   * @param config - SDK configuration. Only `rpcUrl` is required; all
   *   other fields fall back to sensible Testnet defaults.
   * @throws {Error} If the resolved `networkPassphrase` is not a known
   *   Stellar network passphrase.
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
    const resolved = resolveConfig(config)
    this.server = resolved.server
    this.config = resolved.config

    this._stateMgr = new SorobanResurrectStateManager()
    this._simulator = new SorobanResurrectSimulator(
      this.server,
      this.config,
      resolved.simulationCache,
      this._stateMgr,
    )
    this._executor = new SorobanResurrectExecutor(
      this.server,
      this.config,
      this._stateMgr,
      this._simulator,
    )
  }

  // ---------------------------------------------------------------------------
  // State accessors
  // ---------------------------------------------------------------------------

  /** Current workflow state label. */
  get state(): RestoreState {
    return this._stateMgr.state
  }

  /** Snapshot of current state, message, archived keys, and error. */
  get stateInfo(): RestoreStateInfo {
    return this._stateMgr.stateInfo
  }

  // ---------------------------------------------------------------------------
  // Retry
  // ---------------------------------------------------------------------------

  /**
   * Resets the instance back to idle state, clearing archived keys and errors.
   *
   * When `fromState` is provided the reset is a no-op unless the current
   * state matches `fromState` — useful for idempotent resets in concurrent
   * workflows.
   *
   * @param fromState - Only reset if currently in this state (optional).
   *
   * @example
   * ```ts
   * resurrect.reset()
   * console.log(resurrect.state) // 'idle'
   * ```
   */
  reset(fromState?: RestoreState): void {
    this._stateMgr.reset(fromState)
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
   * // later:
   * unsubscribe()
   * ```
   */
  onStateChange(listener: (info: RestoreStateInfo) => void): () => void {
    return this._stateMgr.onStateChange(listener)
  }

  /**
   * Registers a listener for a specific typed event (e.g. `restoreComplete`,
   * `originalSubmitted`, `error`). Returns a function that removes it.
   */
  on<K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ): () => void {
    return this._stateMgr.emitter.on(event, listener)
  }

  /** Registers a listener that fires at most once for the given event. */
  once<K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ): () => void {
    return this._stateMgr.emitter.once(event, listener)
  }

  /** Removes a previously registered listener for the given event. */
  off<K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ): void {
    this._stateMgr.emitter.off(event, listener)
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /**
   * All recorded history entries in insertion order.
   * Each `submitWithRestore` call (including retries) appends an entry.
   */
  get history(): TransactionHistoryEntry[] {
    return this._executor.history
  }

  /**
   * Returns all recorded history entries in insertion order.
   * Equivalent to reading the `history` property.
   */
  getHistory(): TransactionHistoryEntry[] {
    return this._executor.getHistory()
  }

  /** Clears all recorded history entries. */
  clearHistory(): void {
    this._executor.clearHistory()
  }

  // ---------------------------------------------------------------------------
  // Simulation & detection
  // ---------------------------------------------------------------------------

  /**
   * Simulates a transaction on the Soroban RPC endpoint.
   * Updates internal state to `'simulating'`.
   *
   * @param transaction - The transaction to simulate.
   * @returns The raw simulation response from the RPC server.
   * @see {@link detectArchivedKeys} for a higher-level check.
   */
  async simulate(transaction: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
    return this._simulator.simulate(transaction)
  }

  /**
   * Detects archived ledger entries using the configured detection method
   * (`'simulation'` or `'direct'`).
   *
   * Detection errors are caught internally and treated as "no archived keys
   * found" — this method never throws.
   *
   * @param transaction - The transaction whose footprint to inspect.
   * @returns Array of {@link ArchivedLedgerEntry}; empty if nothing is archived.
   *
   * @example
   * ```ts
   * const archived = await resurrect.detectArchivedKeys(tx)
   * if (archived.length > 0) {
   *   console.log(`${archived.length} entries need restoring`)
   * }
   * ```
   */
  async detectArchivedKeys(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    return this._simulator.detectArchivedKeys(transaction)
  }

  /**
   * Convenience method — returns `true` if the transaction requires archive
   * restoration before it can be submitted.
   *
   * @param transaction - The transaction to check.
   * @returns `true` if one or more archived ledger entries were detected.
   *
   * @example
   * ```ts
   * if (await resurrect.needsRestore(tx)) {
   *   // show a "restoring state..." indicator
   * }
   * ```
   */
  async needsRestore(transaction: Transaction): Promise<boolean> {
    return this._simulator.needsRestore(transaction)
  }

  /**
   * Detects archived ledger entries across multiple transactions at once.
   * Returns one array of archived keys per input transaction, in the same order.
   *
   * @param transactions - Transactions to inspect.
   * @returns Array of archived-key arrays, one entry per transaction.
   */
  async detectArchivedKeysBatch(transactions: Transaction[]): Promise<ArchivedLedgerEntry[][]> {
    return Promise.all(transactions.map((tx) => this._simulator.detectArchivedKeys(tx)))
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Builds an unsigned restore transaction for the given source account.
   *
   * @param sourcePublicKey     - The source account public key that will pay.
   * @param transaction         - The transaction to build a restore for.
   * @param simulationResponse  - Optional pre-computed simulation response.
   * @returns An unsigned restore `Transaction` ready to be signed.
   * @throws {Error} If simulation does not indicate a restore is needed.
   *
   * @example
   * ```ts
   * const restoreTx = await resurrect.buildRestoreTx(publicKey, tx)
   * const signedXdr = await wallet.signTransaction(restoreTx.toXDR())
   * ```
   */
  async buildRestoreTx(
    sourcePublicKey: StellarPublicKey | string,
    transaction: Transaction,
    simulationResponse?: rpc.Api.SimulateTransactionRestoreResponse,
  ): Promise<Transaction> {
    return this._executor.buildRestoreTx(sourcePublicKey, transaction, simulationResponse)
  }

  /**
   * Signs and submits a transaction directly, without automatic archive
   * restoration. Use `submitWithRestore` when restoration may be needed.
   *
   * @param transaction - The transaction to sign and submit.
   * @param wallet      - Wallet adapter used for signing.
   * @returns Result with transaction hash on success.
   */
  async sendTransaction(transaction: Transaction, wallet: WalletAdapter): Promise<ResurrectResult> {
    return this._executor.sendTransaction(transaction, wallet)
  }

  /**
   * Submits a transaction with automatic archive restoration.
   *
   * Records the attempt in transaction history. The returned result includes
   * a `historyId` field that can be passed to `retry()` to re-attempt a
   * failed workflow without re-building the transaction.
   *
   * This method never throws — all failures are returned as
   * `ResurrectResult { success: false, error: ... }`.
   *
   * @param options - See {@link SubmitWithRestoreOptions}.
   * @returns {@link ResurrectResult} describing the outcome.
   *
   * @example
   * ```ts
   * const result = await resurrect.submitWithRestore({
   *   transaction: tx,
   *   wallet,
   *   onRestoreNeeded: (keys) => console.log(`Restoring ${keys.length} entries`),
   * })
   * if (result.success) {
   *   console.log('Submitted:', result.originalTxHash)
   * }
   * ```
   */
  async submitWithRestore(options: SubmitWithRestoreOptions): Promise<ResurrectResult> {
    return this._executor.submitWithRestore(options)
  }

  /**
   * Retries a previously recorded restore workflow by history entry id.
   *
   * @param entryId - The `historyId` returned by a prior `submitWithRestore`.
   * @param wallet  - Wallet adapter to use for signing.
   * @returns Result of the retry attempt.
   * @throws {Error} If no history entry exists for `entryId`.
   */
  async retry(entryId: string, wallet: WalletAdapter): Promise<ResurrectResult> {
    return this._executor.retry(entryId, wallet)
  }

  /**
   * Submits multiple transactions with automatic archive restoration,
   * sequentially to avoid sequence-number races.
   *
   * @param items - Array of `SubmitWithRestoreOptions`, one per transaction.
   * @returns Array of results in the same order as the input.
   */
  async submitBatchWithRestore(items: SubmitWithRestoreOptions[]): Promise<ResurrectResult[]> {
    return this._executor.submitBatchWithRestore(items)
  }

  // ---------------------------------------------------------------------------
  // TTL / expiry helpers
  // ---------------------------------------------------------------------------

  /**
   * Queries the current TTL information for one or more ledger keys.
   *
   * @param keys - Ledger keys to query.
   * @returns Aggregated TTL result with per-entry info and query metadata.
   *
   * @example
   * ```ts
   * const result = await resurrect.queryLedgerTTL([ledgerKey])
   * console.log(result.entries[0].ttlLedgers)
   * ```
   */
  async queryLedgerTTL(keys: xdr.LedgerKey[]): Promise<TTLQueryResult> {
    return queryLedgerTTL(this.server, keys)
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
   * if (info.ttlLedgers < 10_000) console.warn('Entry expiring soon!')
   * ```
   */
  async queryLedgerEntryTTL(key: xdr.LedgerKey): Promise<LedgerEntryTTLInfo> {
    return queryLedgerEntryTTL(this.server, key)
  }

  /**
   * Returns ledger entries expiring within `ledgersThreshold` ledgers,
   * including already-archived entries.
   *
   * @param keys              - Ledger keys to query.
   * @param ledgersThreshold  - Maximum ledgers remaining (defaults to 100,000).
   * @returns Entries expiring within the threshold (or already archived).
   *
   * @example
   * ```ts
   * const expiring = await resurrect.getExpiringSoonEntries([key], 17_280) // ~24 h
   * if (expiring.length > 0) showWarning('Your position is expiring soon!')
   * ```
   */
  async getExpiringSoonEntries(
    keys: xdr.LedgerKey[],
    ledgersThreshold = 100_000,
  ): Promise<LedgerEntryTTLInfo[]> {
    return getExpiringSoonEntries(this.server, keys, ledgersThreshold)
  }

  // ---------------------------------------------------------------------------
  // Arbitrary-key restore
  // ---------------------------------------------------------------------------

  /**
   * Restores an arbitrary list of ledger keys directly, without requiring a
   * source transaction's simulated footprint. Builds a `restoreFootprint`
   * transaction over exactly the given keys, signs it with the wallet,
   * submits it, and polls to confirmation.
   *
   * Useful for proactive maintenance — e.g. restoring a contract's data
   * ahead of an upgrade — where there is no "original" transaction to
   * simulate yet.
   *
   * This method never throws — all failures are returned as
   * `ResurrectResult { success: false, error: ... }`.
   *
   * @param keys   - The ledger keys to restore.
   * @param wallet - Wallet adapter used for signing.
   * @param opts   - Optional lifecycle callbacks.
   * @returns {@link ResurrectResult} with `restoreTxHash` set on success.
   *
   * @example
   * ```ts
   * const result = await resurrect.restoreKeys([contractDataKey], wallet)
   * if (result.success) console.log('Restored:', result.restoreTxHash)
   * ```
   */
  async restoreKeys(
    keys: xdr.LedgerKey[],
    wallet: WalletAdapter,
    opts?: RestoreKeysOptions,
  ): Promise<ResurrectResult> {
    return this._executor.restoreKeys(keys, wallet, opts)
  }
}
