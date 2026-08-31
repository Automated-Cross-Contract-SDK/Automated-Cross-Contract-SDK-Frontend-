import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
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

/**
 * Underlying React context. Exported so sibling hooks
 * (`useSorobanResurrectSubmit`, `useRestoreWatcher`,
 * `useSorobanResurrectNetwork`) can opt into the provider's SDK instance
 * when one is present, and fall back to a standalone instance otherwise.
 * Prefer `useSorobanResurrectContext()` in application code.
 */
export const SorobanResurrectContext = createContext<SorobanResurrectContextValue | null>(null)

/**
 * Non-throwing variant of {@link useSorobanResurrectContext}. Returns the
 * context value when called inside a `<SorobanResurrectProvider>`, or
 * `null` when used standalone.
 */
export function useOptionalSorobanResurrectContext(): SorobanResurrectContextValue | null {
  return useContext(SorobanResurrectContext)
}

/**
 * Minimal external-store interface used by {@link useSorobanResurrectSelector}.
 * Provided alongside the main context so selector subscribers can read
 * individual slices via `useSyncExternalStore` without re-rendering on every
 * unrelated state change.
 */
interface SorobanResurrectStore {
  /** Subscribe to context-value changes. Returns an unsubscribe function. */
  subscribe: (onStoreChange: () => void) => () => void
  /** Read the current context value snapshot. */
  getSnapshot: () => SorobanResurrectContextValue
}

const SorobanResurrectStoreContext = createContext<SorobanResurrectStore | null>(null)

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
  if (!prevConfigRef.current || JSON.stringify(config) !== JSON.stringify(prevConfigRef.current)) {
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

  // External store plumbing for `useSorobanResurrectSelector`. `valueRef` always
  // holds the latest context value; listeners are notified after every commit so
  // selector subscribers can re-read their slice and bail out when it is
  // unchanged.
  const valueRef = useRef(value)
  valueRef.current = value
  const listenersRef = useRef<Set<() => void>>(new Set())
  useEffect(() => {
    for (const listener of listenersRef.current) listener()
  })
  const store = useRef<SorobanResurrectStore>({
    subscribe: (onStoreChange: () => void) => {
      listenersRef.current.add(onStoreChange)
      return () => listenersRef.current.delete(onStoreChange)
    },
    getSnapshot: () => valueRef.current,
  }).current

  return (
    <SorobanResurrectStoreContext.Provider value={store}>
      <SorobanResurrectContext.Provider value={value}>{children}</SorobanResurrectContext.Provider>
    </SorobanResurrectStoreContext.Provider>
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

/**
 * Subscribe to a specific slice of the `SorobanResurrect` context value.
 *
 * Unlike {@link useSorobanResurrectContext}, which re-renders the consumer on
 * every state change, this hook only triggers a re-render when the value
 * returned by `selector` actually changes (compared with `isEqual`, defaulting
 * to `Object.is`). It is built on `useSyncExternalStore`, so it is safe for
 * concurrent rendering and SSR.
 *
 * @typeParam T - The selected slice type.
 * @param selector - Pure function mapping the full context value to the slice
 *   this component cares about, e.g. `(s) => s.isProcessing`.
 * @param isEqual - Optional equality comparator for the selected slice. Provide
 *   one when the selector returns a fresh object/array each call.
 * @returns The currently selected slice.
 * @throws {Error} If called outside of {@link SorobanResurrectProvider}.
 *
 * @example
 * ```tsx
 * // Re-renders only when `isProcessing` flips, not on every state message.
 * function Spinner() {
 *   const isProcessing = useSorobanResurrectSelector((s) => s.isProcessing)
 *   return isProcessing ? <Spinner /> : null
 * }
 * ```
 */
export function useSorobanResurrectSelector<T>(
  selector: (value: SorobanResurrectContextValue) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useContext(SorobanResurrectStoreContext)
  if (!store) {
    throw new Error('useSorobanResurrectSelector must be used within a SorobanResurrectProvider')
  }

  const cacheRef = useRef<{ value: T } | null>(null)

  const getSelection = useCallback((): T => {
    const next = selector(store.getSnapshot())
    const cached = cacheRef.current
    if (cached && isEqual(cached.value, next)) {
      return cached.value
    }
    cacheRef.current = { value: next }
    return next
  }, [store, selector, isEqual])

  return useSyncExternalStore(store.subscribe, getSelection, getSelection)
}
