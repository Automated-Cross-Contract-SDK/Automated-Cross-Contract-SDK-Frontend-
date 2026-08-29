import {
  ArchivedLedgerEntry,
  RestoreState,
  RestoreStateInfo,
  SorobanResurrectEvents,
} from './types.js'
import { TypedEventEmitter, type WithIndexSignature } from './EventEmitter.js'

/**
 * Manages the observable workflow state for a `SorobanResurrect` instance.
 *
 * Centralises all state mutation, legacy observer-pattern subscriptions, and
 * typed-event emission in one place so the main facade stays thin.
 *
 * State transitions follow the diagram in `ARCHITECTURE.md`. The `setState`
 * method is the single point of mutation: it updates the internal fields,
 * notifies every registered `onStateChange` listener (catching individual
 * errors so one bad listener cannot break the workflow), and fires the
 * generic `stateChange` typed event.
 *
 * @example
 * ```ts
 * const sm = new SorobanResurrectStateManager()
 * const unsub = sm.onStateChange((info) => console.log(info.state))
 * sm.setState('simulating', 'Simulating transaction...')
 * unsub()
 * ```
 */
export class SorobanResurrectStateManager {
  private _state: RestoreState = 'idle'
  private _message: string = ''
  private _lastError: string | undefined
  private _lastArchivedKeys: ArchivedLedgerEntry[] = []
  private _listeners: Array<(info: RestoreStateInfo) => void> = []

  /** Typed event emitter used alongside the legacy observer pattern. */
  readonly emitter = new TypedEventEmitter<WithIndexSignature<SorobanResurrectEvents>>()

  // ---------------------------------------------------------------------------
  // Read-only accessors
  // ---------------------------------------------------------------------------

  /** Current workflow state label. */
  get state(): RestoreState {
    return this._state
  }

  /** Full snapshot of the current state, message, archived keys, and error. */
  get stateInfo(): RestoreStateInfo {
    return {
      state: this._state,
      message: this._message,
      archivedKeys: this._lastArchivedKeys,
      error: this._lastError,
    }
  }

  /** Last error message, or `undefined` when not in an error state. */
  get lastError(): string | undefined {
    return this._lastError
  }

  /** Last set of detected archived ledger entries. */
  get lastArchivedKeys(): ArchivedLedgerEntry[] {
    return this._lastArchivedKeys
  }

  // ---------------------------------------------------------------------------
  // Mutation
  // ---------------------------------------------------------------------------

  /**
   * Transitions to a new state and notifies all listeners.
   *
   * Side-effects:
   * - Clears `_lastError` for every state except `'error'`.
   * - Clears `_lastArchivedKeys` when entering `'idle'` or `'simulating'`.
   * - Calls every registered `onStateChange` listener, swallowing individual
   *   errors with `console.warn`.
   * - Emits the `stateChange` typed event.
   *
   * @param state   - The new workflow state.
   * @param message - Human-readable status message.
   */
  setState(state: RestoreState, message: string): void {
    this._state = state
    this._message = message
    if (state !== 'error') {
      this._lastError = undefined
    }
    if (state === 'simulating' || state === 'idle') {
      this._lastArchivedKeys = []
    }
    this._notifyListeners()
    this.emitter.emit('stateChange', this.stateInfo)
  }

  /**
   * Records the most recently detected archived ledger entries.
   * Called by the execution layer before transitioning to `'restore_needed'`.
   *
   * @param keys - Archived ledger entries to cache.
   */
  setArchivedKeys(keys: ArchivedLedgerEntry[]): void {
    this._lastArchivedKeys = keys
  }

  /**
   * Records an error message and transitions to the `'error'` state.
   *
   * @param error   - Error message to surface.
   * @param message - Optional human-readable status message (defaults to `error`).
   */
  setError(error: string, message?: string): void {
    this._lastError = error
    this.setState('error', message ?? error)
  }

  /**
   * Resets the manager back to `'idle'`, clearing archived keys and errors.
   *
   * When `fromState` is provided the reset is a no-op unless the current
   * state matches `fromState` exactly — useful for idempotent resets in
   * concurrent workflows.
   *
   * @param fromState - Only reset if currently in this state (optional).
   */
  reset(fromState?: RestoreState): void {
    if (fromState !== undefined && this._state !== fromState) return
    this._lastError = undefined
    this._lastArchivedKeys = []
    this.setState('idle', '')
  }

  // ---------------------------------------------------------------------------
  // Observer pattern — legacy listener API
  // ---------------------------------------------------------------------------

  /**
   * Registers a listener for every state transition.
   *
   * The listener is called synchronously inside `setState` after the
   * internal fields are updated. Errors thrown by the listener are caught
   * and logged via `console.warn` so they cannot corrupt the workflow.
   *
   * @param listener - Callback receiving the current `RestoreStateInfo`.
   * @returns An unsubscribe function that removes the listener.
   *
   * @example
   * ```ts
   * const unsub = sm.onStateChange((info) => console.log(info.state))
   * // later:
   * unsub()
   * ```
   */
  onStateChange(listener: (info: RestoreStateInfo) => void): () => void {
    this._listeners.push(listener)
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener)
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _notifyListeners(): void {
    const info = this.stateInfo
    for (const listener of this._listeners) {
      try {
        listener(info)
      } catch (err) {
        console.warn('SorobanResurrect: state listener error:', err)
      }
    }
  }
}
