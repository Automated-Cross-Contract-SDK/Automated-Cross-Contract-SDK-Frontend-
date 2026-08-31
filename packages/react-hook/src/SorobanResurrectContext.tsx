import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
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

/**
 * Shape of the value provided by `SorobanResurrectContext`. Not exported —
 * consumers should go through `useSorobanResurrectContext()` instead of
 * depending on this shape directly, since it may gain fields over time.
 */
interface SorobanResurrectContextValue {
  /** The underlying SDK instance (null before first render). */
  resurrect: SorobanResurrect | null
  /** Configuration passed to the provider. */
  config: SorobanResurrectConfig
  /** Current workflow state snapshot. */
  state: RestoreStateInfo
  /** Whether a restore/submit operation is in progress. */
  isProcessing: boolean
  /** Submit a transaction with automatic archive restoration. */
  submitWithRestore: (transaction: Transaction, wallet: WalletAdapter) => Promise<ResurrectResult>
  /** Check if a transaction requires archive restoration. */
  detectArchivedKeys: (transaction: Transaction) => Promise<ArchivedLedgerEntry[]>
  /** Reset state back to idle. */
  reset: (fromState?: RestoreState) => void
  /**
   * Subscribes to a typed lifecycle event (`restoreNeeded`, `restoreSubmitted`,
   * `restoreConfirmed`, `originalSubmitted`, `error`, `restoreComplete`, `stateChange`)
   * on the current SDK instance. Returns an unsubscribe function.
   */
  on: <K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ) => () => void
}

const SorobanResurrectContext = createContext<SorobanResurrectContextValue | null>(null)

/** Props for the SorobanResurrectProvider component. */
export interface SorobanResurrectProviderProps {
  /** SDK configuration. */
  config: SorobanResurrectConfig
  /** React children. */
  children: ReactNode
}

/**
 * React context provider that instantiates `SorobanResurrect` and
 * subscribes to its state changes. Children can access the API via
 * `useSorobanResurrectContext()`.
 *
 * When the config prop changes, a new SDK instance is created and
 * state is reset to idle.
 *
 * @param props - See {@link SorobanResurrectProviderProps}.
 * @see {@link useSorobanResurrectContext} to consume the value from a
 *   descendant component.
 * @see {@link useSorobanResurrect} for a standalone alternative that
 *   doesn't require a provider.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <SorobanResurrectProvider config={{ rpcUrl: 'https://soroban-testnet.stellar.org' }}>
 *       <WithdrawButton />
 *     </SorobanResurrectProvider>
 *   )
 * }
 * ```
 */
export function SorobanResurrectProvider({ config, children }: SorobanResurrectProviderProps) {
  const resurrectRef = useRef<SorobanResurrect | null>(null)
  const prevConfigRef = useRef<SorobanResurrectConfig | null>(null)
  const [state, setState] = useState<RestoreStateInfo>({
    state: 'idle',
    message: '',
  })

  // Track config changes and reinitialize SDK when config updates
  if (
    !prevConfigRef.current ||
    JSON.stringify(config) !== JSON.stringify(prevConfigRef.current)
  ) {
    prevConfigRef.current = config
    resurrectRef.current = new SorobanResurrect(config)
  }

  useEffect(() => {
    const r = resurrectRef.current
    if (!r) return

    setState({ state: 'idle', message: '' })
    const unsubscribe = r.onStateChange((info: RestoreStateInfo) => {
      setState(info)
    })

    return unsubscribe
  }, [JSON.stringify(config)])

  const submitWithRestore = useCallback(
    async (transaction: Transaction, wallet: WalletAdapter): Promise<ResurrectResult> => {
      const r = resurrectRef.current
      if (!r) {
        return { success: false, archivedKeysDetected: 0, error: 'Not initialized' }
      }
      return r.submitWithRestore({ transaction, wallet })
    },
    [],
  )

  const detectArchivedKeys = useCallback(
    async (transaction: Transaction): Promise<ArchivedLedgerEntry[]> => {
      const r = resurrectRef.current
      if (!r) return []
      return r.detectArchivedKeys(transaction)
    },
    [],
  )

  const reset = useCallback((fromState?: RestoreState) => {
    resurrectRef.current?.reset(fromState)
  }, [])

  const on = useCallback(<K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ) => {
    const r = resurrectRef.current
    return r ? r.on(event, listener) : () => {}
  }, [])

  const isProcessing = isProcessingState(state.state)

  const value: SorobanResurrectContextValue = {
    resurrect: resurrectRef.current,
    config,
    state,
    isProcessing,
    submitWithRestore,
    detectArchivedKeys,
    reset,
    on,
  }

  return (
    <SorobanResurrectContext.Provider value={value}>{children}</SorobanResurrectContext.Provider>
  )
}

/**
 * Hook to access the `SorobanResurrect` API from within a
 * `<SorobanResurrectProvider>`. Throws if used outside the provider.
 *
 * @returns The current `SorobanResurrectContextValue` (SDK instance,
 *   state, and bound action methods).
 * @throws {Error} If called from a component not wrapped in
 *   {@link SorobanResurrectProvider}.
 *
 * @example
 * ```tsx
 * function WithdrawButton() {
 *   const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()
 *   // ...
 * }
 * ```
 */
export function useSorobanResurrectContext(): SorobanResurrectContextValue {
  const ctx = useContext(SorobanResurrectContext)
  if (!ctx) {
    throw new Error('useSorobanResurrectContext must be used within a SorobanResurrectProvider')
  }
  return ctx
}
