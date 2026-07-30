import {
  ref,
  computed,
  watch,
  onUnmounted,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
  type ShallowRef,
  type ComputedRef,
} from 'vue'
import {
  SorobanResurrect,
  type SorobanResurrectConfig,
  type WalletAdapter,
  type RestoreStateInfo,
  type RestoreState,
  type ArchivedLedgerEntry,
  type ResurrectResult,
} from '@soroban-resurrect/sdk'
import type { Transaction } from '@stellar/stellar-sdk'

/** Return value of the `useSorobanResurrect` composable. */
export interface UseSorobanResurrectReturn {
  /** Current workflow state snapshot. */
  state: ReturnType<typeof ref<RestoreStateInfo>>
  /** Whether a restore/submit operation is in progress. */
  isProcessing: ComputedRef<boolean>
  /** Submit a transaction with automatic archive restoration. */
  submitWithRestore: (transaction: Transaction, wallet: WalletAdapter) => Promise<ResurrectResult>
  /** Check if a transaction requires archive restoration. */
  detectArchivedKeys: (transaction: Transaction) => Promise<ArchivedLedgerEntry[]>
  /** Reset state back to idle. Optionally, only reset if in a specific state. */
  reset: (fromState?: RestoreState) => void
  /** The underlying SDK instance. */
  resurrect: ShallowRef<SorobanResurrect | null>
}

/**
 * Vue 3 composable that creates and manages a `SorobanResurrect` instance.
 *
 * Subscribes to SDK state changes and exposes the full API as reactive refs.
 * Automatically creates a new SDK instance when the config changes.
 * Calls `onUnmounted` internally — no manual cleanup required.
 *
 * @example
 * ```ts
 * const { state, isProcessing, submitWithRestore, reset } = useSorobanResurrect(config)
 * ```
 */
export function useSorobanResurrect(
  configRef: MaybeRefOrGetter<SorobanResurrectConfig>,
): UseSorobanResurrectReturn {
  const resurrect = shallowRef<SorobanResurrect | null>(null)
  const state = ref<RestoreStateInfo>({ state: 'idle', message: '' })
  let unsubscribeState: (() => void) | null = null

  // Watch config changes and reinitialize the SDK
  watch(
    () => toValue(configRef),
    (newConfig) => {
      // Clean up previous subscription
      if (unsubscribeState) {
        unsubscribeState()
        unsubscribeState = null
      }

      resurrect.value = new SorobanResurrect(newConfig)
      state.value = { state: 'idle', message: '' }

      unsubscribeState = resurrect.value.onStateChange((info: RestoreStateInfo) => {
        state.value = info
      })
    },
    { immediate: true, deep: true },
  )

  // Clean up on component unmount
  onUnmounted(() => {
    if (unsubscribeState) {
      unsubscribeState()
      unsubscribeState = null
    }
  })

  const isProcessing = computed(() => {
    const s = state.value.state
    return (
      s === 'simulating' ||
      s === 'signing_restore' ||
      s === 'submitting_restore' ||
      s === 'confirming_restore' ||
      s === 'signing_original' ||
      s === 'submitting_original'
    )
  })

  const submitWithRestore = async (
    transaction: Transaction,
    wallet: WalletAdapter,
  ): Promise<ResurrectResult> => {
    if (!resurrect.value) {
      return { success: false, archivedKeysDetected: 0, error: 'Not initialized' }
    }
    return resurrect.value.submitWithRestore({ transaction, wallet })
  }

  const detectArchivedKeys = async (
    transaction: Transaction,
  ): Promise<ArchivedLedgerEntry[]> => {
    if (!resurrect.value) return []
    return resurrect.value.detectArchivedKeys(transaction)
  }

  const reset = (fromState?: RestoreState) => {
    resurrect.value?.reset(fromState)
  }

  return {
    state,
    isProcessing,
    submitWithRestore,
    detectArchivedKeys,
    reset,
    resurrect,
  }
}
