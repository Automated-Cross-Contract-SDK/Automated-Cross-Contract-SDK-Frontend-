import type { Transaction } from '@stellar/stellar-sdk'
import type { SorobanResurrectConfig } from './types.js'
import { SOROBAN_MAX_TX_XDR_BYTES, RESTORE_TX_SIZE_WARN_RATIO } from './constants.js'

/**
 * Size / fee diagnostics for a built restore transaction.
 *
 * Attached (non-enumerable) to the `Transaction` returned by
 * {@link buildRestoreTransaction} as `restoreDiagnostics`, and also returned
 * directly by {@link evaluateRestoreFootprint}.
 */
export interface RestoreTxDiagnostics {
  /** Serialized transaction envelope size, in bytes. */
  estimatedSizeBytes: number
  /** Resource fee (stroops) charged for the restore, from simulation. */
  estimatedResourceFee: number
  /** The Soroban max transaction size the estimate is compared against. */
  maxSizeBytes: number
  /** `estimatedSizeBytes / maxSizeBytes`, in the range `[0, ∞)`. */
  sizeRatio: number
  /** Ratio threshold at which `approachingLimit` flips to `true`. */
  warnRatio: number
  /** `true` once `sizeRatio >= warnRatio` (includes the over-limit case). */
  approachingLimit: boolean
  /** `true` when `estimatedSizeBytes > maxSizeBytes`. */
  exceedsLimit: boolean
}

/** Options for {@link evaluateRestoreFootprint}. */
export interface EvaluateRestoreFootprintOptions {
  /** Override the Soroban max tx size (bytes). Default {@link SOROBAN_MAX_TX_XDR_BYTES}. */
  maxSizeBytes?: number
  /** Override the warn ratio. Default {@link RESTORE_TX_SIZE_WARN_RATIO}. */
  warnRatio?: number
}

/**
 * Serialized size, in bytes, of a transaction's XDR envelope.
 *
 * This is the exact payload the wallet signs and the network receives, so it is
 * the right quantity to compare against the Soroban transaction size limit.
 */
export function estimateRestoreTxSizeBytes(tx: Transaction): number {
  return tx.toEnvelope().toXDR().length
}

/**
 * Pure estimation math: given a serialized size and resource fee, compute how
 * close the restore transaction is to the Soroban size limit.
 *
 * No I/O, no logging — safe to unit test in isolation.
 */
export function evaluateRestoreFootprint(
  sizeBytes: number,
  resourceFee: number,
  options: EvaluateRestoreFootprintOptions = {},
): RestoreTxDiagnostics {
  const maxSizeBytes = options.maxSizeBytes ?? SOROBAN_MAX_TX_XDR_BYTES
  const rawWarnRatio = options.warnRatio ?? RESTORE_TX_SIZE_WARN_RATIO
  // Clamp to a sane range so a misconfigured ratio can't disable the guard
  // entirely or make it fire on every transaction.
  const warnRatio = Math.min(Math.max(rawWarnRatio, 0), 1)

  const sizeRatio = maxSizeBytes > 0 ? sizeBytes / maxSizeBytes : Infinity

  return {
    estimatedSizeBytes: sizeBytes,
    estimatedResourceFee: resourceFee,
    maxSizeBytes,
    sizeRatio,
    warnRatio,
    approachingLimit: sizeRatio >= warnRatio,
    exceedsLimit: sizeBytes > maxSizeBytes,
  }
}

/**
 * Human-readable guidance emitted alongside a size warning / error.
 */
export function restoreSizeGuidance(d: RestoreTxDiagnostics): string {
  const pct = (d.sizeRatio * 100).toFixed(1)
  return (
    `SorobanResurrect: restore transaction is ${d.estimatedSizeBytes} bytes ` +
    `(${pct}% of the ${d.maxSizeBytes}-byte Soroban limit). ` +
    `Split the restore into smaller batches of ledger keys to stay well under the limit.`
  )
}

/**
 * Resolves the size-guard options from SDK config, applying defaults.
 */
export function resolveFootprintGuardOptions(config: SorobanResurrectConfig): {
  maxSizeBytes: number
  warnRatio: number
  throwOnLimit: boolean
} {
  return {
    maxSizeBytes: config.maxRestoreTxSizeBytes ?? SOROBAN_MAX_TX_XDR_BYTES,
    warnRatio: config.restoreSizeWarnRatio ?? RESTORE_TX_SIZE_WARN_RATIO,
    throwOnLimit: config.throwOnRestoreSizeLimit ?? false,
  }
}
