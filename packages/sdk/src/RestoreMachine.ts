import { createMachine, interpret, assign } from '@xstate/fsm'
import type { StateMachine } from '@xstate/fsm'
import type { RestoreState, RestoreStateInfo, ArchivedLedgerEntry } from './types.js'

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Union of all events the restore state machine can receive.
 * Each event corresponds to a step in the restore-and-submit workflow.
 */
export type RestoreMachineEvent =
  | { type: 'SIMULATE' }
  | { type: 'RESTORE_NEEDED'; keys: ArchivedLedgerEntry[] }
  | { type: 'NO_RESTORE_NEEDED' }
  | { type: 'SIGN_RESTORE' }
  | { type: 'SUBMIT_RESTORE' }
  | { type: 'CONFIRM_RESTORE' }
  | { type: 'SIGN_ORIGINAL' }
  | { type: 'SUBMIT_ORIGINAL' }
  | { type: 'SUCCESS' }
  | { type: 'FAIL'; error: string }
  | { type: 'RESET' }

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Extended context stored alongside the finite state.
 * Holds the human-readable message, detected archived keys, and any error.
 */
export interface RestoreMachineContext {
  /** Human-readable status message for the current state. */
  message: string
  /** Archived ledger entries detected during simulation. */
  archivedKeys: ArchivedLedgerEntry[]
  /** Error message if the workflow failed. */
  error: string | undefined
}

// ---------------------------------------------------------------------------
// Typestate — one entry per FSM state to keep context clean
// ---------------------------------------------------------------------------

export type RestoreTypestate =
  | { value: 'idle'; context: RestoreMachineContext }
  | { value: 'simulating'; context: RestoreMachineContext }
  | { value: 'restore_needed'; context: RestoreMachineContext }
  | { value: 'signing_restore'; context: RestoreMachineContext }
  | { value: 'submitting_restore'; context: RestoreMachineContext }
  | { value: 'confirming_restore'; context: RestoreMachineContext }
  | { value: 'signing_original'; context: RestoreMachineContext }
  | { value: 'submitting_original'; context: RestoreMachineContext }
  | { value: 'success'; context: RestoreMachineContext }
  | { value: 'error'; context: RestoreMachineContext }

// ---------------------------------------------------------------------------
// Shared transition objects used across multiple states
// ---------------------------------------------------------------------------

/** Transitions every non-terminal state shares: FAIL, SUCCESS, and RESET. */
const commonTransitions = {
  FAIL: {
    target: 'error' as const,
    actions: 'applyError',
  },
  SUCCESS: {
    target: 'success' as const,
    actions: 'enterSuccess',
  },
  RESET: {
    target: 'idle' as const,
    actions: 'resetContext',
  },
}

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

/**
 * Finite state machine modelling the full restore-and-submit workflow.
 *
 * State values map 1-to-1 to the {@link RestoreState} union type so that
 * `service.state.value` can be cast directly to `RestoreState`.
 *
 * All intermediate states accept `FAIL` (→ error), `SUCCESS` (→ success),
 * and `RESET` (→ idle) so that executor callbacks arriving out-of-order
 * (e.g. in test mocks) are handled gracefully.
 *
 * Valid primary transitions:
 * ```
 * idle              --SIMULATE---------->  simulating
 * simulating        --RESTORE_NEEDED---->  restore_needed
 * simulating        --NO_RESTORE_NEEDED-> signing_original
 * restore_needed    --SIGN_RESTORE------> signing_restore
 * signing_restore   --SUBMIT_RESTORE---->  submitting_restore
 * submitting_restore--CONFIRM_RESTORE-->  confirming_restore
 * confirming_restore--SIGN_ORIGINAL---->  signing_original
 * signing_original  --SUBMIT_ORIGINAL-->  submitting_original
 * submitting_original--SUCCESS---------> success
 * <any intermediate>--FAIL------------->  error
 * <any intermediate>--SUCCESS----------> success
 * <any>             --RESET------------>  idle
 * ```
 */
export const restoreMachine = createMachine<
  RestoreMachineContext,
  RestoreMachineEvent,
  RestoreTypestate
>(
  {
    id: 'soroban-resurrect',
    initial: 'idle',
    context: {
      message: '',
      archivedKeys: [],
      error: undefined,
    },
    states: {
      idle: {
        on: {
          SIMULATE: {
            target: 'simulating',
            actions: 'enterSimulating',
          },
          RESET: {
            target: 'idle',
            actions: 'resetContext',
          },
        },
      },
      simulating: {
        on: {
          RESTORE_NEEDED: {
            target: 'restore_needed',
            actions: 'enterRestoreNeeded',
          },
          NO_RESTORE_NEEDED: {
            target: 'signing_original',
            actions: 'enterSigningOriginalDirect',
          },
          ...commonTransitions,
        },
      },
      restore_needed: {
        on: {
          SIGN_RESTORE: {
            target: 'signing_restore',
            actions: 'enterSigningRestore',
          },
          ...commonTransitions,
        },
      },
      signing_restore: {
        on: {
          SUBMIT_RESTORE: {
            target: 'submitting_restore',
            actions: 'enterSubmittingRestore',
          },
          ...commonTransitions,
        },
      },
      submitting_restore: {
        on: {
          CONFIRM_RESTORE: {
            target: 'confirming_restore',
            actions: 'enterConfirmingRestore',
          },
          ...commonTransitions,
        },
      },
      confirming_restore: {
        on: {
          SIGN_ORIGINAL: {
            target: 'signing_original',
            actions: 'enterSigningOriginalAfterRestore',
          },
          ...commonTransitions,
        },
      },
      signing_original: {
        on: {
          SUBMIT_ORIGINAL: {
            target: 'submitting_original',
            actions: 'enterSubmittingOriginal',
          },
          ...commonTransitions,
        },
      },
      submitting_original: {
        on: {
          ...commonTransitions,
        },
      },
      success: {
        on: {
          RESET: {
            target: 'idle',
            actions: 'resetContext',
          },
        },
      },
      error: {
        on: {
          RESET: {
            target: 'idle',
            actions: 'resetContext',
          },
        },
      },
    },
  },
  {
    // Named action implementations — separated from structure for readability
    // and testability. The machine config describes *what* transitions happen;
    // these implementations describe *how* context is updated on each.
    actions: {
      enterSimulating: assign({
        message: () => 'Simulating transaction...',
        archivedKeys: () => [],
        error: () => undefined,
      }),

      enterRestoreNeeded: assign({
        message: (_ctx: RestoreMachineContext, event: RestoreMachineEvent) =>
          event.type === 'RESTORE_NEEDED'
            ? `Detected ${event.keys.length} archived ledger entries`
            : '',
        archivedKeys: (_ctx: RestoreMachineContext, event: RestoreMachineEvent) =>
          event.type === 'RESTORE_NEEDED' ? event.keys : [],
      }),

      enterSigningOriginalDirect: assign({
        message: () => 'Signing original transaction...',
      }),

      enterSigningRestore: assign({
        message: () => 'Awaiting wallet signature for restore transaction...',
      }),

      enterSubmittingRestore: assign({
        message: () => 'Submitting restore transaction...',
      }),

      enterConfirmingRestore: assign({
        message: () => 'Waiting for restore confirmation...',
      }),

      enterSigningOriginalAfterRestore: assign({
        message: () => 'Restore confirmed. Preparing original transaction...',
      }),

      enterSubmittingOriginal: assign({
        message: () => 'Submitting original transaction...',
      }),

      enterSuccess: assign({
        message: () => 'Original transaction submitted successfully',
        error: () => undefined,
      }),

      applyError: assign({
        error: (_ctx: RestoreMachineContext, event: RestoreMachineEvent) =>
          event.type === 'FAIL' ? event.error : undefined,
        message: (_ctx: RestoreMachineContext, event: RestoreMachineEvent) =>
          event.type === 'FAIL' ? event.error : '',
      }),

      resetContext: assign({
        message: () => '',
        archivedKeys: () => [],
        error: () => undefined,
      }),
    },
  },
)

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Creates and starts an interpreted restore state machine service.
 *
 * The returned service is already running (`start()` has been called).
 * Subscribe to state changes with `service.subscribe(listener)`, which
 * returns `{ unsubscribe }`.
 *
 * @example
 * ```ts
 * const service = createRestoreService()
 * const { unsubscribe } = service.subscribe((state) => {
 *   console.log(state.value, state.context.message)
 * })
 * service.send({ type: 'SIMULATE' })
 * service.stop()
 * ```
 */
export function createRestoreService(): StateMachine.Service<
  RestoreMachineContext,
  RestoreMachineEvent,
  RestoreTypestate
> {
  return interpret(restoreMachine).start()
}

export type RestoreService = ReturnType<typeof createRestoreService>

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Converts the machine's current state value + context into a
 * {@link RestoreStateInfo} snapshot compatible with the existing public
 * API of `SorobanResurrect`.
 */
export function toRestoreStateInfo(
  value: string,
  context: RestoreMachineContext,
): RestoreStateInfo {
  return {
    state: value as RestoreState,
    message: context.message,
    archivedKeys: context.archivedKeys,
    error: context.error,
  }
}
