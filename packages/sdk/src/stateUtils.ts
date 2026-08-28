import type { RestoreState } from './types.js'

/**
 * The set of `RestoreState` values that represent an actively in-flight
 * restore/submit workflow. Used by all framework hooks to derive the
 * `isProcessing` flag without duplicating the state list.
 */
export const PROCESSING_STATES = new Set<RestoreState>([
  'simulating',
  'signing_restore',
  'submitting_restore',
  'confirming_restore',
  'signing_original',
  'submitting_original',
])

/**
 * Returns `true` when the given `RestoreState` represents an actively
 * in-flight operation (i.e. the workflow is neither idle nor in a terminal
 * state). This is the single source of truth for the `isProcessing` flag
 * exposed by every framework hook.
 *
 * @param state - The current `RestoreState` value.
 * @returns `true` for `simulating`, `signing_restore`, `submitting_restore`,
 *   `confirming_restore`, `signing_original`, and `submitting_original`;
 *   `false` for `idle`, `restore_needed`, `success`, and `error`.
 *
 * @example
 * ```ts
 * import { isProcessingState } from '@soroban-resurrect/sdk'
 *
 * const isProcessing = isProcessingState(state.state)
 * ```
 */
export function isProcessingState(state: RestoreState): boolean {
  return PROCESSING_STATES.has(state)
}
