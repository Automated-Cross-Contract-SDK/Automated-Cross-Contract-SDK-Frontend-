import type { SorobanResurrectConfig } from './types.js'
import { BASE_FEE, type xdr } from '@stellar/stellar-sdk'
import { RestoreFeeExceededError } from './errors.js'
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
 * A 3x multiplier keeps restore transactions competitive under congestion
 * without requiring users to hand-tune the fee cap in the common case.
 *
 * @param minResourceFee - Minimum resource fee from simulation (integer stroops).
 * @param config - SDK configuration (used to resolve the multiplier).
 * @returns The calculated restore fee as a string (required by TransactionBuilder).
 *
 * @example
 * ```ts
 * const fee = calculateRestoreFee(parseInt(simResponse.minResourceFee, 10), config)
 * // fee === '300' when minResourceFee === 100 and multiplier === 3
 * ```
 */
export function calculateRestoreFee(
  minResourceFee: number,
  config: SorobanResurrectConfig,
): string {
  const multiplier = resolveRestoreFeeMultiplier(config)
  return (minResourceFee * multiplier).toString()
}

/**
 * Converts a total transaction fee into the per-operation fee to hand to
 * `TransactionBuilder`, which adds the Soroban resource fee on top in `build()`.
 * Passing the total directly would charge the resource fee twice.
 *
 * The inclusion fee never drops below the network minimum; if that pushes the
 * transaction above `maxRestoreFeeStroops`, this throws instead.
 */
export function toBuilderFee(
  totalFee: string,
  sorobanData: xdr.SorobanTransactionData,
  config: Pick<SorobanResurrectConfig, 'maxRestoreFeeStroops'>,
): string {
  const resourceFee = sorobanData.resourceFee
  const remainder = BigInt(Math.trunc(Number(totalFee))) - resourceFee
  const minimum = BigInt(BASE_FEE)
  const inclusionFee = remainder > minimum ? remainder : minimum
  const cap = config.maxRestoreFeeStroops
  if (cap !== undefined && inclusionFee + resourceFee > BigInt(cap)) {
    throw new RestoreFeeExceededError(Number(inclusionFee + resourceFee), Number(cap))
  }
  return inclusionFee.toString()
}

/** Structured estimate of the cost (and need) of restoring a transaction's archived entries. */
export interface RestoreCostEstimate {
  /** Minimum resource fee from simulation (integer stroops), 0 when no restore is needed. */
  minResourceFee: number
  /** Fee multiplier applied to `minResourceFee` (see {@link resolveRestoreFeeMultiplier}). */
  multiplier: number
  /** Estimated restore transaction fee, in stroops (`minResourceFee * multiplier`). */
  estimatedFee: string
  /** Number of archived ledger entries detected. */
  archivedKeysDetected: number
  /** Whether the transaction requires a restore before it can be submitted. */
  wouldNeedRestore: boolean
}

/**
 * Builds a {@link RestoreCostEstimate} from a `minResourceFee` and archived-key
 * count, applying the same multiplier math as {@link calculateRestoreFee}.
 *
 * @param minResourceFee - Minimum resource fee from simulation (0 when no restore is needed).
 * @param archivedKeysDetected - Number of archived ledger entries detected.
 * @param config - SDK configuration (used to resolve the multiplier).
 * @see {@link SorobanResurrect.estimateRestoreCost} — the facade method that
 *   simulates a transaction and delegates here for the fee math.
 */
export function buildRestoreCostEstimate(
  minResourceFee: number,
  archivedKeysDetected: number,
  config: SorobanResurrectConfig,
): RestoreCostEstimate {
  return {
    minResourceFee,
    multiplier: resolveRestoreFeeMultiplier(config),
    estimatedFee: calculateRestoreFee(minResourceFee, config),
    archivedKeysDetected,
    wouldNeedRestore: archivedKeysDetected > 0,
  }
}
