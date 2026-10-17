/**
 * Read-only summary returned by {@link SorobanResurrect.previewRestore}.
 *
 * Ledger keys are encoded as base64 XDR so the plan can be safely serialized
 * for UI review without exposing mutable XDR objects.
 */
export interface RestorePlan {
  /** Summary of the caller's original transaction. */
  transaction: {
    xdr: string
    sourceAccount: string
    sequence: string
    fee: string
    operationCount: number
  }
  /** Network used to simulate the transaction. */
  network: {
    rpcUrl: string
    networkPassphrase: string
  }
  /** Whether the simulation reports archived entries that need restoring. */
  wouldNeedRestore: boolean
  /** Base64 XDR ledger keys in the restore footprint; empty when no restore is needed. */
  archivedKeys: string[]
  /** Minimum resource fee in stroops; zero when no restore is needed. */
  minResourceFee: number
  /** Configured restore fee multiplier. */
  feeMultiplier: number
  /** Estimated restore fee in stroops. */
  estimatedRestoreFee: string
}

/** @deprecated Use {@link RestorePlan}; retained as a descriptive compatibility alias. */
export type DryRunResult = RestorePlan
