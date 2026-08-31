import { useState, useCallback, useRef, useEffect } from 'react'
import {
  SorobanResurrect,
  isProcessingState,
  type SorobanResurrectConfig,
  type WalletAdapter,
  type RestoreStateInfo,
  type ArchivedLedgerEntry,
  type ResurrectResult,
  type RestoreState,
  type SorobanResurrectEvents,
} from '@soroban-resurrect/sdk'
import type { Transaction } from '@stellar/stellar-sdk'

/** Options for the `useSorobanResurrect` hook. */
export interface UseSorobanResurrectOptions {
  /** SDK configuration. */
  config: SorobanResurrectConfig
}

/** Return value of the `useSorobanResurrect` hook. */
export interface UseSorobanResurrectReturn {
  /** Current workflow state snapshot. */
  state: RestoreStateInfo
  /** Whether a restore/submit operation is in progress. */
  isProcessing: boolean
  /** Submit a transaction with automatic archive restoration. */
  submitWithRestore: (transaction: Transaction, wallet: WalletAdapter) => Promise<ResurrectResult>
  /** Check if a transaction requires archive restoration. */
  detectArchivedKeys: (transaction: Transaction) => Promise<ArchivedLedgerEntry[]>
  /** Reset state back to idle. Optionally, only reset if in a specific state. */
  reset: (fromState?: RestoreState) => void
  /**
   * Subscribes to a typed SDK lifecycle event (`restoreSubmitted`,
   * `restoreConfirmed`, `originalSubmitted`, `error`, `restoreComplete`,
   * `restoreNeeded`, `stateChange`) without reaching into `resurrect`
   * directly. Always binds to the current SDK instance, so it keeps working
   * across a config change that recreates the instance — a listener
   * attached via `resurrect.on(...)` captured before that point would be
   * subscribed to the discarded instance instead.
   *
   * @returns An unsubscribe function.
   */
  on: <K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ) => () => void
  /** The underlying SDK instance. */
  resurrect: SorobanResurrect
}

/**
 * Standalone hook that creates and manages a `SorobanResurrect` instance.
 * Subscribes to state changes and exposes the full API. Unlike the context
 * provider pattern, this hook manages its own instance and is suitable for
 * use in components that are not wrapped in `SorobanResurrectProvider`.
 *
 * When the config prop changes, a new SDK instance is created and
 * state is reset to idle.
 *
 * @param options - See {@link UseSorobanResurrectOptions}.
 * @returns See {@link UseSorobanResurrectReturn}.
 * @see {@link SorobanResurrectProvider} / `useSorobanResurrectContext` for
 *   the context-based alternative, useful when multiple components need
 *   access to the same SDK instance.
 *
 * @example
 * ```tsx
 * function WithdrawButton() {
 *   const { submitWithRestore, state, isProcessing } = useSorobanResurrect({
 *     config: { rpcUrl: 'https://soroban-testnet.stellar.org' },
 *   })
 *
 *   return (
 *     <button onClick={() => submitWithRestore(tx, wallet)} disabled={isProcessing}>
 *       {isProcessing ? state.message : 'Withdraw'}
 *     </button>
 *   )
 * }
 * ```
 */
export function useSorobanResurrect(
  options: UseSorobanResurrectOptions,
): UseSorobanResurrectReturn {
  const { config } = options
  const resurrectRef = useRef<SorobanResurrect | null>(null)
  const prevConfigRef = useRef<SorobanResurrectConfig | null>(null)
  const [state, setState] = useState<RestoreStateInfo>({
    state: 'idle',
    message: '',
  })

  // Track config changes and reinitialize SDK when config updates
  if (!prevConfigRef.current || JSON.stringify(config) !== JSON.stringify(prevConfigRef.current)) {
    prevConfigRef.current = config
    resurrectRef.current = new SorobanResurrect(config)
  }

  useEffect(() => {
    const r = resurrectRef.current!
    setState({ state: 'idle', message: '' })
    const unsub = r.onStateChange((info: RestoreStateInfo) => {
      setState(info)
    })
    return unsub
  }, [JSON.stringify(config)])

  const submitWithRestore = useCallback(async (transaction: Transaction, wallet: WalletAdapter) => {
    return resurrectRef.current!.submitWithRestore({ transaction, wallet })
  }, [])

  const detectArchivedKeys = useCallback(async (transaction: Transaction) => {
    return resurrectRef.current!.detectArchivedKeys(transaction)
  }, [])

  const reset = useCallback((fromState?: RestoreState) => {
    resurrectRef.current!.reset(fromState)
  }, [])

  const on = useCallback(
    <K extends keyof SorobanResurrectEvents>(
      event: K,
      listener: (payload: SorobanResurrectEvents[K]) => void,
    ) => resurrectRef.current!.on(event, listener),
    [],
  )

  const isProcessing = isProcessingState(state.state)

  return {
    state,
    isProcessing,
    submitWithRestore,
    detectArchivedKeys,
    reset,
    on,
    resurrect: resurrectRef.current!,
  }
}
