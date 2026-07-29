import { rpc, Transaction } from '@stellar/stellar-sdk'
import {
  SorobanResurrectConfig,
  RestoreState,
  RestoreStateInfo,
  ArchivedLedgerEntry,
  ResurrectResult,
  SubmitWithRestoreOptions,
  SorobanResurrectEvents,
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

/**
 * Main facade for the Soroban-Resurrect SDK.
 *
 * Provides a high-level API for detecting archived ledger entries,
 * building restore transactions, and submitting transactions with
 * automatic archive restoration. State changes are published to
 * registered listeners via the observer pattern.
 *
 * @see {@link SorobanResurrectConfig} for constructor options.
 * @see {@link onStateChange} to subscribe to workflow state transitions.
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
  private _emitter = new TypedEventEmitter<SorobanResurrectEvents>()

  /**
   * Creates a new SDK instance bound to a single Soroban RPC endpoint.
   *
   * Logs a console warning (does not throw) if `networkPassphrase` is
   * provided but does not match a known network — the instance is still
   * created and usable.
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
    const networkPassphrase = config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
    
    // Validate network passphrase against known networks
    if (!KNOWN_NETWORK_PASSPHRASES.includes(networkPassphrase)) {
      const knownNetworks = KNOWN_NETWORK_PASSPHRASES.map((p) => `"${p}"`).join(', ')
      const message =
        `Invalid network passphrase: "${networkPassphrase}". ` +
        `Must be one of: ${knownNetworks}. ` +
        `A typo in the passphrase will cause cryptic transaction failures.`
      throw new Error(message)
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
   *
   * Listener errors are caught and logged (via `console.warn`) so a
   * misbehaving listener cannot break the workflow or prevent other
   * listeners from being notified.
   *
   * @param listener - Callback invoked with a {@link RestoreStateInfo}
   *   snapshot on every state transition.
   * @returns Function that removes the listener when called.
   * @see {@link stateInfo} for the current snapshot without subscribing.
   *
   * @example
   * ```ts
   * const unsubscribe = resurrect.onStateChange((info) => {
   *   console.log(info.state, info.message)
   * })
   * // later
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

  private emitState() {
    const info = this.stateInfo
    for (const listener of this._listeners) {
      try {
        listener(info)
      } catch (err) {
        console.warn('SorobanResurrect: state listener error:', err)
      }
    }
    this._emitter.emit('stateChange', info)
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
   *
   * @example
   * ```ts
   * resurrect.reset()
   * console.log(resurrect.state) // 'idle'
   * ```
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
   * @param transaction - The transaction to simulate.
   * @returns The raw {@link SimulateResponse} from the RPC server (success,
   *   error, or restore-required response).
   * @see {@link detectArchivedKeys} for a higher-level check that inspects
   *   the simulation result for you.
   */
  async simulate(transaction: Transaction) {
    this.setState('simulating', 'Simulating transaction...')
    const response = await this.server.simulateTransaction(transaction)
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
   *
   * Detection errors (network failures, RPC errors) are caught internally,
   * logged via `console.warn`, and treated as "no archived keys found" — this
   * method never throws.
   *
   * @param transaction - The transaction whose footprint should be checked
   *   for archived ledger entries.
   * @returns Array of {@link ArchivedLedgerEntry} — empty if nothing is
   *   archived or detection failed.
   * @see {@link needsRestore} for a boolean convenience wrapper.
   * @see {@link buildRestoreTx} to build the transaction that restores the
   *   detected keys.
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
   *
   * @param transaction - The transaction to check.
   * @returns `true` if one or more archived ledger entries were detected.
   * @see {@link detectArchivedKeys} to get the actual archived keys.
   *
   * @example
   * ```ts
   * if (await resurrect.needsRestore(tx)) {
   *   // show a "restoring state..." indicator before submitting
   * }
   * ```
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
   * @param sourcePublicKey - The source account public key that will pay
   *   for and sign the restore transaction.
   * @param transaction - The transaction to build a restore for.
   * @param simulationResponse - Optional pre-computed simulation response
   *   (to avoid state side-effects and a redundant RPC call).
   * @returns An unsigned restore `Transaction` containing a
   *   `restoreFootprint` operation, ready to be signed and submitted.
   * @throws {Error} If the simulation (provided or freshly run) does not
   *   indicate a restore is needed — call {@link needsRestore} first if
   *   you're not sure.
   * @see {@link submitWithRestore} for the full end-to-end workflow that
   *   builds, signs, and submits the restore transaction automatically.
   *
   * @example
   * ```ts
   * const restoreTx = await resurrect.buildRestoreTx(publicKey, tx)
   * const signedXdr = await wallet.signTransaction(restoreTx.toXDR())
   * ```
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
   * If the simulation detects archived entries, a restore transaction
   * is built, signed, submitted, and confirmed before the original
   * transaction is rebuilt and submitted. State transitions are
   * published to all registered listeners.
   *
   * This method never throws — all failures (simulation errors, signing
   * rejections, network errors, restore failures) are caught and returned
   * as a {@link ResurrectResult} with `success: false` and an `error`
   * message.
   *
   * @param options - See {@link SubmitWithRestoreOptions}. Requires a
   *   `transaction` and a `wallet` adapter; all lifecycle callbacks are
   *   optional.
   * @returns A {@link ResurrectResult} describing the outcome, including
   *   transaction hashes for the restore step (if any) and the original
   *   transaction.
   * @see {@link onStateChange} to observe fine-grained workflow state
   *   transitions (`signing_restore`, `confirming_restore`, etc.) as they
   *   happen, in addition to the final result.
   * @see {@link needsRestore} to check ahead of time whether a restore
   *   step will be needed.
   *
   * @example
   * ```ts
   * const result = await resurrect.submitWithRestore({
   *   transaction: tx,
   *   wallet,
   *   onRestoreNeeded: (keys) => console.log(`Restoring ${keys.length} entries`),
   * })
   *
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

    const result = await executeWithRestore({
      server: this.server,
      transaction,
      wallet,
      config: this.config,
      // Wallet is about to prompt the user to sign the restore tx —
      // surface this so the UI can show a signing indicator.
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
        this._emitter.emit('restoreNeeded', keys)
        callbacks.onRestoreNeeded?.(keys)
      },
      onRestoreSubmitted: (txHash) => {
        this.setState('confirming_restore', 'Waiting for restore confirmation...')
        this._emitter.emit('restoreSubmitted', txHash)
        callbacks.onRestoreSubmitted?.(txHash)
      },
      onRestoreConfirmed: (txHash) => {
        this.setState(
          'submitting_original',
          'Restore confirmed. Preparing original transaction...',
        )
        this._emitter.emit('restoreConfirmed', txHash)
        callbacks.onRestoreConfirmed?.(txHash)
      },
      onSigningOriginal: () => {
        this.setState('signing_original', 'Signing original transaction...')
        onSigningOriginal?.()
      },
      onOriginalSubmitted: (txHash) => {
        this.setState('success', 'Original transaction submitted successfully')
        this._emitter.emit('originalSubmitted', txHash)
        callbacks.onOriginalSubmitted?.(txHash)
      },
      onRestoreFailed: (error) => {
        this._emitter.emit('error', error)
        onRestoreFailed?.(error)
      },
    })

    if (!result.success) {
      this._lastError = result.error
      this.setState('error', result.error ?? 'Unknown error')
      this._emitter.emit('error', result.error ?? 'Unknown error')
    }

    this._emitter.emit('restoreComplete', result)

    return result
  }

  /**
   * Detects archived ledger entries across multiple transactions at once.
   * Returns one array of archived keys per input transaction, in the same
   * order, useful for surfacing restore requirements ahead of a bulk submit.
   */
  async detectArchivedKeysBatch(transactions: Transaction[]): Promise<ArchivedLedgerEntry[][]> {
    return Promise.all(transactions.map((transaction) => this.detectArchivedKeys(transaction)))
  }

  /**
   * Submits multiple transactions with automatic archive restoration, one
   * after another. Transactions are processed sequentially (rather than in
   * parallel) to avoid sequence-number races when multiple transactions
   * share the same source account.
   *
   * Each transaction's result is collected independently — a failure on one
   * transaction does not prevent the remaining transactions from being
   * processed.
   */
  async submitBatchWithRestore(items: SubmitWithRestoreOptions[]): Promise<ResurrectResult[]> {
    const results: ResurrectResult[] = []
    for (const item of items) {
      results.push(await this.submitWithRestore(item))
    }
    return results
  }
}
