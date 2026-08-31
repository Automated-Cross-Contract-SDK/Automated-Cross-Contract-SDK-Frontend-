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
} from './types.js'
import { resolveConfig } from './SorobanResurrectConfig.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import type { StellarPublicKey } from './branded-types.js'
import { SorobanResurrectStateManager } from './SorobanResurrectState.js'
import { SorobanResurrectSimulator } from './SorobanResurrectSimulation.js'
import { SorobanResurrectExecutor } from './SorobanResurrectExecution.js'
import { isRestoreResponse, extractArchivedKeys } from './Archiver.js'
import { buildRestoreCostEstimate, type RestoreCostEstimate } from './feeCalculation.js'
import type { TransactionHistoryEntry } from './TransactionHistory.js'
import {
  queryLedgerTTL,
  queryLedgerEntryTTL,
  getExpiringSoonEntries,
} from './TTLHelpers.js'
import type { LedgerEntryTTLInfo, TTLQueryResult } from './TTLHelpers.js'
import { NETWORK_PRESETS } from './constants.js'
import type { SorobanNetworkName } from './constants.js'

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
const debug = createDebugger('core')

export class SorobanResurrect {
  private _server: ISorobanRpcClient
  private _config: Required<Omit<SorobanResurrectConfig, 'rpcClient'>> & { rpcClient: ISorobanRpcClient }

  private readonly _stateMgr: SorobanResurrectStateManager
  private readonly _simulator: SorobanResurrectSimulator
  private readonly _executor: SorobanResurrectExecutor

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
    this._server = resolved.server
    this._config = resolved.config

    this._stateMgr = new SorobanResurrectStateManager()
    this._simulator = new SorobanResurrectSimulator(
      this._server,
      this._config,
      resolved.simulationCache,
      this._stateMgr,
    )
    this._executor = new SorobanResurrectExecutor(
      this._server,
      this._config,
      this._stateMgr,
      this._simulator,
    )
  }

  // ---------------------------------------------------------------------------
  // Config / server accessors
  // ---------------------------------------------------------------------------

  /**
   * The RPC client used for all Soroban network calls.
   *
   * Exposes the {@link ISorobanRpcClient} interface rather than the
   * concrete `rpc.Server` class, making it possible to inject test
   * doubles via `config.rpcClient` without casting. Re-bound in place by
   * {@link switchNetwork}.
   */
  get server(): ISorobanRpcClient {
    return this._server
  }

  /** Resolved configuration with defaults applied. Re-bound in place by {@link switchNetwork}. */
  get config(): Required<Omit<SorobanResurrectConfig, 'rpcClient'>> & { rpcClient: ISorobanRpcClient } {
    return this._config
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
  // Network switching
  // ---------------------------------------------------------------------------

  /**
   * Re-binds the RPC client and network passphrase in place — no need to
   * construct a new `SorobanResurrect` instance to switch networks.
   *
   * History, registered listeners, and the internal state machine instance
   * are all kept intact; only the underlying RPC client and resolved config
   * are swapped. Emits a `networkChanged` event once the switch completes.
   *
   * @param presetOrConfig - Either a well-known network name (`'testnet'`,
   *   `'mainnet'`, `'futurenet'`) or a partial config overriding the current
   *   one (must include `rpcUrl` if not using a preset name).
   * @throws {Error} If the resolved `networkPassphrase` is not a known
   *   Stellar network passphrase.
   *
   * @example
   * ```ts
   * resurrect.switchNetwork('mainnet')
   * // or with a custom endpoint:
   * resurrect.switchNetwork({ rpcUrl: 'https://my-rpc.example.com', networkPassphrase: '...' })
   * ```
   */
  switchNetwork(
    presetOrConfig: SorobanNetworkName | (Partial<SorobanResurrectConfig> & { rpcUrl: string }),
  ): void {
    const overrideConfig: SorobanResurrectConfig =
      typeof presetOrConfig === 'string'
        ? {
            ...this._config,
            rpcUrl: NETWORK_PRESETS[presetOrConfig].rpcUrl,
            networkPassphrase: NETWORK_PRESETS[presetOrConfig].networkPassphrase,
            rpcClient: undefined,
          }
        : { ...this._config, ...presetOrConfig }

    const resolved = resolveConfig(overrideConfig)

    this._server = resolved.server
    this._config = resolved.config
    this._simulator.rebind(resolved.server, resolved.config, resolved.simulationCache)
    this._executor.rebind(resolved.server, resolved.config)

    this._stateMgr.emitter.emit('networkChanged', {
      rpcUrl: resolved.config.rpcUrl,
      networkPassphrase: resolved.config.networkPassphrase,
    })
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
    const keys = await this._simulator.detectArchivedKeys(transaction)
    this._standaloneArchivedKeys = keys
    return keys
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

  /**
   * Estimates the cost of restoring a transaction's archived entries without
   * submitting anything to the network.
   *
   * Simulates the transaction, and — when a restore is needed — reads
   * `minResourceFee` from the restore response and applies the configured
   * {@link SorobanResurrectConfig.restoreFeeMultiplier}. Returns a
   * `wouldNeedRestore: false` estimate (zero fee) when no restore is required.
   *
   * @param transaction - The transaction to estimate a restore cost for.
   * @returns A {@link RestoreCostEstimate}.
   *
   * @example
   * ```ts
   * const estimate = await resurrect.estimateRestoreCost(tx)
   * if (estimate.wouldNeedRestore) {
   *   console.log(`Restore would cost ~${estimate.estimatedFee} stroops`)
   * }
   * ```
   */
  async estimateRestoreCost(transaction: Transaction): Promise<RestoreCostEstimate> {
    const response = await this._simulator.simulate(transaction)

    if (isRestoreResponse(response)) {
      const archivedKeys = extractArchivedKeys(response)
      const minResourceFee = parseInt(response.minResourceFee, 10)
      return buildRestoreCostEstimate(minResourceFee, archivedKeys.length, this._config)
    }

    return buildRestoreCostEstimate(0, 0, this._config)
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
    return queryLedgerTTL(this._server, keys)
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
    return queryLedgerEntryTTL(this._server, key)
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
    return getExpiringSoonEntries(this._server, keys, ledgersThreshold)
  }
}
