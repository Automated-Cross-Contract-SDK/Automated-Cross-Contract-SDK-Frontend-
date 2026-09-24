import {
  ref,
  watch,
  onMounted,
  toValue,
  type Ref,
  type MaybeRefOrGetter,
} from 'vue'
import { RESTORE_FEE_MULTIPLIER } from '@soroban-resurrect/sdk'
import { rpc, type Transaction } from '@stellar/stellar-sdk'
import { resolveResurrect, type ResolveResurrectOptions } from './resolveResurrect.js'

/** Reactive fee estimate for a transaction (and its restore, if needed). */
export interface SorobanFeeEstimate {
  /** Minimum resource fee from simulation, in stroops. */
  minResourceFee: string
  /** Whether simulation indicates archived entries must be restored first. */
  needsRestore: boolean
  /** Multiplier the SDK applies when building the restore transaction. */
  restoreFeeMultiplier: number
  /** Estimated restore-transaction fee in stroops (`'0'` when no restore needed). */
  estimatedRestoreFee: string
  /** Raw simulation response. */
  raw: rpc.Api.SimulateTransactionResponse
}

/** Options for `useSorobanResurrectEstimate`. */
export interface UseSorobanResurrectEstimateOptions extends ResolveResurrectOptions {
  /** Re-estimate automatically whenever the transaction changes. Defaults to `true`. */
  auto?: boolean
}

/** Return value of `useSorobanResurrectEstimate`. */
export interface UseSorobanResurrectEstimateReturn {
  /** The latest estimate, or `null` before the first run / on error. */
  estimate: Ref<SorobanFeeEstimate | null>
  /** `true` while a simulation is in flight. */
  refreshing: Ref<boolean>
  /** Error message from the last failed estimate, or `null`. */
  error: Ref<string | null>
  /** Run the estimate now. */
  refresh: () => Promise<void>
}

/**
 * Vue composable that estimates transaction fees (and the cost of a restore,
 * when simulation reports archived entries) via `SorobanResurrect.simulate`.
 *
 * Reactive and SSR-safe: the first estimate is deferred to `onMounted`, so no
 * RPC call happens during server-side rendering. Mirrors the semantics of the
 * React `useSorobanResurrect` fee helpers.
 *
 * @example
 * ```ts
 * const { estimate, refreshing } = useSorobanResurrectEstimate(tx, { config })
 * ```
 */
export function useSorobanResurrectEstimate(
  tx: MaybeRefOrGetter<Transaction | null | undefined>,
  options: UseSorobanResurrectEstimateOptions,
): UseSorobanResurrectEstimateReturn {
  const { auto = true } = options
  const resurrect = resolveResurrect(options)

  const estimate = ref<SorobanFeeEstimate | null>(null)
  const refreshing = ref(false)
  const error = ref<string | null>(null)

  const refresh = async (): Promise<void> => {
    const instance = resurrect.value
    const transaction = toValue(tx)
    if (!instance || !transaction) return

    refreshing.value = true
    error.value = null
    try {
      const raw = await instance.simulate(transaction)

      if (rpc.Api.isSimulationError(raw)) {
        error.value = raw.error
        estimate.value = null
        return
      }

      const minResourceFee = raw.minResourceFee ?? '0'
      const needsRestore = rpc.Api.isSimulationRestore(raw)
      const multiplier = RESTORE_FEE_MULTIPLIER
      const estimatedRestoreFee = needsRestore
        ? (Number(minResourceFee) * multiplier).toString()
        : '0'

      estimate.value = {
        minResourceFee,
        needsRestore,
        restoreFeeMultiplier: multiplier,
        estimatedRestoreFee,
        raw,
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      estimate.value = null
    } finally {
      refreshing.value = false
    }
  }

  // Re-estimate on transaction / instance change — but never during SSR setup.
  watch(
    [resurrect, () => toValue(tx)],
    () => {
      if (auto) void refresh()
    },
    { deep: false },
  )

  onMounted(() => {
    if (auto) void refresh()
  })

  return { estimate, refreshing, error, refresh }
}
