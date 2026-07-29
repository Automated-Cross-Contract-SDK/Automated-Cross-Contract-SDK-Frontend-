import { rpc, Transaction } from '@stellar/stellar-sdk'
import {
  SorobanResurrectConfig,
  RestoreState,
  RestoreStateInfo,
  ArchivedLedgerEntry,
  ResurrectResult,
  SubmitWithRestoreOptions,
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
import { SimulationCache } from './SimulationCache.js'

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
  private _simulationCache: SimulationCache | undefined

  constructor(config: SorobanResurrectConfig) {
    this.server = new rpc.Server(config.rpcUrl)

    const networkPassphrase =
      config.networkPassphrase ??
      resolveNetworkPassphrase(config.rpcUrl) ??
      DEFAULT_NETWORK_PASSPHRASE

    // Validate network passphrase against known networks
    if (!KNOWN_NETWORK_PASSPHRASES.includes(networkPassphrase)) {
      console.warn(
        `Warning: Unknown network passphrase "${networkPassphrase}". ` +
          `Known networks: ${KNOWN_NETWORK_PASSPHRASES.join(', ')}. ` +
          `Transactions may fail with cryptic errors if the passphrase is incorrect.`,
      )
    }

    // Initialize the simulation cache if enabled
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
   *
   * If the simulation cache is enabled, cached results are reused
   * when the same logical transaction is simulated again.
   */
  async simulate(transaction: Transaction) {
    this.setState('simulating', 'Simulating transaction...')

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
   * If archiveDetectionMethod is 'simulation', uses the simulation-based approach
   * (extracting archived keys from the restore response).
   *
   * If archiveDetectionMethod is 'direct', queries the ledger directly for
   * keys that appear in the transaction footprint.
   */
  async detectArchivedKeys(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    const method = (this.config as Required<typeof this.config>).archiveDetectionMethod ?? 'simulation'

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

  /**
   * Detects archived keys using simulation-based approach.
   * This simulates the transaction and extracts archived keys from
   * the restore response if one is returned.
   *
   * @private
   */
  private async detectArchivedKeysViaSimulation(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
    const response = await this.simulate(transaction)

    if (isRestoreResponse(response)) {
      return extractArchivedKeys(response)
    }

    return []
  }

  /**
   * Detects archived keys using direct ledger query.
   * This simulates the transaction in success mode, extracts the footprint keys,
   * then queries the ledger to find which ones are archived.
   *
   * This approach avoids triggering a restore response and can be useful for
   * monitoring or diagnostics.
   *
   * @private
   */
  private async detectArchivedKeysViaDirect(transaction: Transaction): Promise<ArchivedLedgerEntry[]> {
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
   *
   * If simulationResponse is provided, it is used directly and no simulation
   * is performed. This avoids state changes and is useful when called during
   * or alongside the submitWithRestore workflow.
   *
   * If simulationResponse is not provided, the transaction is simulated first.
   * This will update internal state to 'simulating'.
   *
   * Throws if the simulation does not indicate a restore is needed.
   *
   * @param sourcePublicKey - The source account public key
   * @param transaction - The transaction to build a restore for
   * @param simulationResponse - Optional pre-computed simulation response (to avoid state side-effects)
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
   * Signs and submits a transaction directly, without automatic archive
   * restoration. This is a lighter-weight alternative to `submitWithRestore`
   * for transactions known not to require restoration.
   *
   * If you want automatic detection and restoration, use `submitWithRestore`.
   *
   * @param transaction - The Soroban transaction to sign and submit
   * @param wallet - Wallet adapter used for signing
   * @returns A result object with the transaction hash on success
   */
  async sendTransaction(
    transaction: Transaction,
    wallet: WalletAdapter,
  ): Promise<ResurrectResult> {
    return sendTransaction(this.server, transaction, wallet, this.config)
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
    const { transaction, wallet, onRestoreFailed, onSigningRestore, onSubmittingRestore, onSigningOriginal, ...callbacks } = options

    const result = await executeWithRestore({
      server: this.server,
      transaction,
      wallet,
      config: this.config,
      simulationCache: this._simulationCache,
      onSigningRestore: () => {
        this.setState('signing_restore', 'Signing restore transaction...')
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
        this.setState(
          'submitting_original',
          'Restore confirmed. Preparing original transaction...',
        )
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

  /**
   * Auto-detects the network passphrase by calling `getNetwork()` on the
   * Soroban RPC server. Returns the resolved passphrase.
   *
   * This can be used to verify the current network or to set the passphrase
   * automatically without manual configuration.
   *
   * @returns The network passphrase string
   * @throws If the RPC call fails
   */
  async detectNetworkPassphrase(): Promise<string> {
    const network = await this.server.getNetwork()
    return network.passphrase
  }
}
