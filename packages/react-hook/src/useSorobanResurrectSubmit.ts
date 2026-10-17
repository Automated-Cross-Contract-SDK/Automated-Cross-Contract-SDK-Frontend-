import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isProcessingState,
  type RestoreStateInfo,
  type ResurrectResult,
  type WalletAdapter,
} from '@soroban-resurrect/sdk'
import type { Transaction } from '@stellar/stellar-sdk'
import {
  useResolvedResurrect,
  type ResolvedResurrectOptions,
} from './useResolvedResurrect.js'

/** Options for the `useSorobanResurrectSubmit` hook. */
export interface UseSorobanResurrectSubmitOptions extends ResolvedResurrectOptions {
  /** Called after a successful submit (`result.success === true`). */
  onSuccess?: (result: ResurrectResult) => void
  /** Called when the submit fails or throws. */
  onError?: (error: string) => void
  /** Called on completion regardless of outcome. */
  onSettled?: (result: ResurrectResult | null, error: string | null) => void
}

/** Return value of the `useSorobanResurrectSubmit` hook. */
export interface UseSorobanResurrectSubmitReturn {
  /** Submit a transaction with automatic archive restoration. */
  submit: (transaction: Transaction, wallet: WalletAdapter) => Promise<ResurrectResult>
  /** Whether a submit/restore operation is currently in progress. */
  isProcessing: boolean
  /** Result of the most recent submit, or `null` before the first call. */
  result: ResurrectResult | null
  /** Error string from the most recent submit, or `null` if none. */
  error: string | null
  /** Live workflow state snapshot from the SDK. */
  state: RestoreStateInfo
  /** Cancel workflows started by this hook. Already-submitted transactions cannot be recalled. */
  cancel: () => boolean
  /** Clear `result`/`error` and reset the SDK workflow state to idle. */
  reset: () => void
}

/**
 * Mutation-style wrapper around `SorobanResurrect.submitWithRestore`, giving
 * the same ergonomics as react-query's `useMutation`: a `submit` action plus
 * reactive `result`, `error`, `isProcessing`, and `reset`.
 *
 * Works both inside a `<SorobanResurrectProvider>` (reuses the provider's
 * instance) and standalone (pass `config` or an explicit `resurrect`
 * instance). State is driven by the SDK's own `onStateChange`
 * subscription — no manual bookkeeping in the caller.
 *
 * @example
 * ```tsx
 * function WithdrawButton({ tx, wallet }) {
 *   const { submit, isProcessing, result, error, reset } = useSorobanResurrectSubmit({
 *     config: { rpcUrl: 'https://soroban-testnet.stellar.org' },
 *   })
 *
 *   if (error) return <button onClick={reset}>Retry ({error})</button>
 *   if (result?.success) return <span>Done: {result.originalTxHash}</span>
 *   return (
 *     <button onClick={() => submit(tx, wallet)} disabled={isProcessing}>
 *       {isProcessing ? 'Working…' : 'Withdraw'}
 *     </button>
 *   )
 * }
 * ```
 */
export function useSorobanResurrectSubmit(
  options: UseSorobanResurrectSubmitOptions = {},
): UseSorobanResurrectSubmitReturn {
  const resurrect = useResolvedResurrect(options)

  const [state, setState] = useState<RestoreStateInfo>(
    () => resurrect.stateInfo ?? { state: 'idle', message: '' },
  )
  const [result, setResult] = useState<ResurrectResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep callbacks fresh without re-subscribing / re-creating `submit`.
  const cbRef = useRef(options)
  cbRef.current = options
  const mountedRef = useRef(false)
  const requestIdRef = useRef(0)
  const controllersRef = useRef(new Set<AbortController>())

  useEffect(() => {
    mountedRef.current = true
    setState(resurrect.stateInfo ?? { state: 'idle', message: '' })
    const unsub = resurrect.onStateChange((info) => {
      if (mountedRef.current) setState(info)
    })
    return () => {
      mountedRef.current = false
      requestIdRef.current++
      for (const controller of controllersRef.current) controller.abort()
      controllersRef.current.clear()
      unsub()
    }
  }, [resurrect])

  const submit = useCallback(
    async (transaction: Transaction, wallet: WalletAdapter): Promise<ResurrectResult> => {
      const requestId = ++requestIdRef.current
      const controller = new AbortController()
      controllersRef.current.add(controller)
      if (mountedRef.current) {
        setResult(null)
        setError(null)
      }

      let outcome: ResurrectResult
      try {
        outcome = await resurrect.submitWithRestore({
          transaction,
          wallet,
          signal: controller.signal,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        outcome = { success: false, archivedKeysDetected: 0, error: message }
      } finally {
        controllersRef.current.delete(controller)
      }

      const errText = outcome.success ? null : outcome.error ?? 'Unknown error'
      if (mountedRef.current && requestId === requestIdRef.current) {
        setResult(outcome)
        setError(errText)

        if (outcome.success) cbRef.current.onSuccess?.(outcome)
        else if (errText) cbRef.current.onError?.(errText)
        cbRef.current.onSettled?.(outcome, errText)
      }

      return outcome
    },
    [resurrect],
  )

  const cancel = useCallback(() => {
    let cancelled = false
    for (const controller of controllersRef.current) {
      if (!controller.signal.aborted) {
        controller.abort()
        cancelled = true
      }
    }
    return cancelled
  }, [])

  const reset = useCallback(() => {
    requestIdRef.current++
    cancel()
    setResult(null)
    setError(null)
    resurrect.reset()
  }, [cancel, resurrect])

  return {
    submit,
    isProcessing: isProcessingState(state.state),
    result,
    error,
    state,
    cancel,
    reset,
  }
}
