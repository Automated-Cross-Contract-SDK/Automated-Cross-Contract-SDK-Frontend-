import type { SorobanResurrectConfig } from './types.js'
import { RESTORE_FEE_MULTIPLIER } from './constants.js'

/**
 * Resolves the fee multiplier to use when building a restore transaction.
 *
 * Returns config.restoreFeeMultiplier when explicitly set, otherwise
 * falls back to the {@link RESTORE_FEE_MULTIPLIER} constant (3).
 *
 * @param config - SDK configuration, optionally carrying a custom multiplier.
 * @returns The effective fee multiplier (always >= 1).
 */
export function resolveRestoreFeeMultiplier(config: SorobanResurrectConfig): number {
  return (config as Required<SorobanResurrectConfig>).restoreFeeMultiplier ?? RESTORE_FEE_MULTIPLIER
}

/**
 * Calculates the fee (in stroops) for a restore transaction.
 *
 * Fee = minResourceFee * multiplier, where the multiplier defaults to
 * {@link RESTORE_FEE_MULTIPLIER} (3x) but can be overridden via
 * config.restoreFeeMultiplier.
 *
 * A 3x multiplier is a reasonable balance: high enough to ensure inclusion
 * during network congestion, but not so excessive that users overpay.
 *
 * @param minResourceFee - Minimum resource fee from simulation (integer stroops).
 * @param config - SDK configuration (used to resolve the multiplier).
 * @returns The calculated restore fee as a string (required by TransactionBuilder).
 *
 * @example
 * `	s
 * const fee = calculateRestoreFee(parseInt(simResponse.minResourceFee, 10), config)
 * // fee === '300' when minResourceFee === 100 and multiplier === 3
 * `
 */
export function calculateRestoreFee(
  minResourceFee: number,
  config: SorobanResurrectConfig,
): string {
  const multiplier = resolveRestoreFeeMultiplier(config)
  return (minResourceFee * multiplier).toString()
}

/**
 * Thrown by {@link buildRestoreTransaction} (see `Restorer.ts`) when the
 * computed restore fee exceeds `config.maxRestoreFeeStroops`. Carries both
 * numbers so a caller (or the CLI/UI surfacing `ResurrectResult.error`) can
 * show a specific "X exceeds your Y cap" message instead of a generic string.
 */
export class RestoreFeeExceededError extends Error {
  constructor(
    /** The fee the restore transaction would have used, in stroops. */
    public readonly computedFeeStroops: string,
    /** The configured `maxRestoreFeeStroops` cap that was exceeded. */
    public readonly capFeeStroops: string,
  ) {
    super(
      `Restore fee ${computedFeeStroops} stroops exceeds the configured cap of ${capFeeStroops} stroops ` +
        `(maxRestoreFeeStroops). Raise the cap, lower restoreFeeMultiplier, or omit maxRestoreFeeStroops ` +
        `to accept the computed fee.`,
    )
    this.name = 'RestoreFeeExceededError'
  }
}

/**
 * Throws {@link RestoreFeeExceededError} if `feeStroops` exceeds
 * `config.maxRestoreFeeStroops`. A no-op when the cap is unset (the default),
 * so most callers pay whatever the simulation-derived fee computes to, as
 * before this option existed.
 */
export function assertRestoreFeeWithinCap(
  feeStroops: string,
  config: SorobanResurrectConfig,
): void {
  const cap = config.maxRestoreFeeStroops
  if (cap === undefined) {
    return
  }
  if (BigInt(feeStroops) > BigInt(cap)) {
    throw new RestoreFeeExceededError(feeStroops, cap)
  }
}
