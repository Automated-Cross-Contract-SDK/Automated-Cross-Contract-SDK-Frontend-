import { ref, type Ref } from 'vue'
import type { ResurrectResult } from '@soroban-resurrect/sdk'

/** Result/notice/error slots the withdraw card renders. */
export interface WithdrawOutputs {
  /** Pretty-printed `ResurrectResult` after a submit. */
  result: Ref<string | null>
  /** Informational line (e.g. the outcome of an archive check). */
  notice: Ref<string | null>
  /** Message from a failure caught outside the SDK state machine. */
  errorMessage: Ref<string | null>
  setResult: (value: ResurrectResult) => void
  setNotice: (value: string) => void
  fail: (err: unknown) => void
  clear: () => void
}

/**
 * Plain UI bookkeeping shared by both integration paths — nothing here is
 * SDK-specific, which is why it lives outside the composable-vs-plugin
 * comparison.
 */
export function useWithdrawOutputs(): WithdrawOutputs {
  const result = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)

  const clear = (): void => {
    result.value = null
    notice.value = null
    errorMessage.value = null
  }

  return {
    result,
    notice,
    errorMessage,
    setResult: (value) => {
      result.value = JSON.stringify(value, null, 2)
    },
    setNotice: (value) => {
      notice.value = value
    },
    fail: (err) => {
      errorMessage.value = err instanceof Error ? err.message : String(err)
    },
    clear,
  }
}
