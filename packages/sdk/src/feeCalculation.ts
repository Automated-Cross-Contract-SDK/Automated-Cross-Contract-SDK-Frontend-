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
export function resolveRestoreFeeMultiplier(
  config: SorobanResurrectConfig,
): number {
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