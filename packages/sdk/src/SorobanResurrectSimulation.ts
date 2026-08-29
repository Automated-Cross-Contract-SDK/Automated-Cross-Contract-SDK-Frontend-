import { rpc, Transaction } from '@stellar/stellar-sdk'
import { ArchivedLedgerEntry, SorobanResurrectConfig } from './types.js'
import { SimulationCache } from './SimulationCache.js'
import { isRestoreResponse, isSuccessResponse, isErrorResponse, extractArchivedKeys } from './Archiver.js'
import { SorobanResurrectStateManager } from './SorobanResurrectState.js'
import type { ISorobanRpcClient } from './RpcClient.js'

/**
 * Handles transaction simulation and archived-entry detection for a single
 * `SorobanResurrect` instance.
 *
 * The two archive-detection strategies are kept here:
 * - **simulation** — simulates the transaction and reads the restore-response
 *   footprint (default, no extra RPC call needed).
 * - **direct** — queries the ledger directly for each key in the transaction
 *   footprint (more precise, but requires an extra `getLedgerEntries` call).
 *
 * The `simulate` method manages the `SimulationCache` when one is provided,
 * and drives the `SorobanResurrectStateManager` to `'simulating'` before each
 * RPC call so the UI can react immediately.
 *
 * All detection errors are swallowed and logged — `detectArchivedKeys` never
 * throws so callers do not need to guard against network failures.
 */
export class SorobanResurrectSimulator {
  private _server: ISorobanRpcClient
  private _config: Required<SorobanResurrectConfig>
  private _cache: SimulationCache | undefined
  private readonly _stateMgr: SorobanResurrectStateManager

  /**
   * @param server   - Soroban RPC client bound to the configured endpoint.
   * @param config   - Fully resolved SDK configuration.
   * @param cache    - Optional simulation cache; `undefined` disables caching.
   * @param stateMgr - State manager used to publish `'simulating'` transitions.
   */
  constructor(
    server: ISorobanRpcClient,
    config: Required<SorobanResurrectConfig>,
    cache: SimulationCache | undefined,
    stateMgr: SorobanResurrectStateManager,
  ) {
    this._server = server
    this._config = config
    this._cache = cache
    this._stateMgr = stateMgr
  }

  /**
   * Re-binds this simulator to a new RPC client / config / cache in place,
   * without losing any other state. Used by `SorobanResurrect.switchNetwork`.
   */
  rebind(server: ISorobanRpcClient, config: Required<SorobanResurrectConfig>, cache: SimulationCache | undefined): void {
    this._server = server
    this._config = config
    this._cache = cache
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Simulates a transaction against the Soroban RPC endpoint.
   *
   * Transitions state to `'simulating'` before issuing the RPC call.
   * When a `SimulationCache` is present, a cached result is returned
   * immediately (without an RPC call or state transition) if one exists;
   * fresh responses are cached after a successful call.
   *
   * @param transaction - The transaction to simulate.
   * @returns The raw simulation response (success, error, or restore-required).
   */
  async simulate(transaction: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
    if (this._cache) {
      const cached = this._cache.get(transaction)
      if (cached) return cached
    }

    this._stateMgr.setState('simulating', 'Simulating transaction...')

    const response = await this._server.simulateTransaction(transaction)

    if (this._cache) {
      this._cache.set(transaction, response)
    }

    return response
  }

  /**
   * Detects archived ledger entries for a transaction using the method
   * configured in `config.archiveDetectionMethod` (`'simulation'` or `'direct'`).
   *
   * Detection failures (network errors, RPC errors) are caught, logged via
   * `console.warn`, and treated as "no archived keys found" — this method
   * never throws.
   *
   * @param transaction - The transaction whose footprint to inspect.
   * @returns Array of archived ledger entries; empty if none detected or on error.
   */
  async detectArchivedKeys(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    const method = this._config.archiveDetectionMethod ?? 'simulation'

    try {
      if (method === 'direct') {
        return await this._detectViaDirect(transaction)
      }
      return await this._detectViaSimulation(transaction)
    } catch (err) {
      console.warn('SorobanResurrect: archive detection error:', err)
      return []
    }
  }

  /**
   * Convenience wrapper — returns `true` when at least one archived entry
   * is detected for the given transaction.
   *
   * @param transaction - The transaction to check.
   * @returns `true` if restoration is required before submission.
   */
  async needsRestore(transaction: Transaction): Promise<boolean> {
    const keys = await this.detectArchivedKeys(transaction)
    return keys.length > 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Simulation-based detection: simulates the transaction and reads the
   * `transactionData` footprint from a restore response.
   *
   * When the response can't be classified as restore-required, success, or
   * error (e.g. an older soroban-rpc version that doesn't produce a
   * `SimulateTransactionRestoreResponse` shape) and
   * `config.archiveDetectionFallback` is not explicitly disabled, falls back
   * to the `'direct'` strategy so archived entries aren't silently missed.
   */
  private async _detectViaSimulation(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    const response = await this.simulate(transaction)

    if (isRestoreResponse(response)) {
      return extractArchivedKeys(response)
    }

    if (isSuccessResponse(response) || isErrorResponse(response)) {
      return []
    }

    // Unclassifiable response shape.
    if (this._config.archiveDetectionFallback === false) {
      return []
    }

    console.warn(
      'SorobanResurrect: simulation response could not be classified as success/error/restore-required; ' +
        "falling back to the 'direct' archive detection strategy. " +
        'Set archiveDetectionFallback: false to disable this and pin a strategy explicitly.',
    )
    return this._detectViaDirect(transaction)
  }

  /**
   * Direct detection: dynamically imports `detectArchivedKeysViaDirect` from
   * `Archiver.ts` and queries the ledger for archived entries in the
   * transaction footprint.
   *
   * The dynamic import keeps the main bundle lean when direct detection
   * is not used.
   */
  private async _detectViaDirect(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    const { detectArchivedKeysViaDirect } = await import('./Archiver.js')
    return detectArchivedKeysViaDirect(this._server, transaction)
  }
}
