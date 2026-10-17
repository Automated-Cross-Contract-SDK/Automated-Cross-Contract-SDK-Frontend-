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
  createSubscriptionStore,
  type SubscriptionStore,
} from '@soroban-resurrect/sdk'
import type { Transaction } from '@stellar/stellar-sdk'

/**
 * Shape of the value provided by `SorobanResurrectContext`.
 */
export interface SorobanResurrectContextValue {
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

interface PendingEventSubscription {
  attach: (instance: SorobanResurrect) => void
  detach: () => void
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
 * `useSorobanResurrectContext()`. The SDK is initialized after commit rather
 * than during render, so server rendering does not access browser storage or
 * construct clients that are discarded by React's render checks.
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
  const eventSubscriptionsRef = useRef<Set<PendingEventSubscription>>(new Set())
  const [state, setState] = useState<RestoreStateInfo>({
    state: 'idle',
    message: '',
  })

  useEffect(() => {
    const r = new SorobanResurrect(config)
    resurrectRef.current = r
    setState({ state: 'idle', message: '' })
    const unsubscribe = r.onStateChange((info: RestoreStateInfo) => {
      setState(info)
    })
    for (const subscription of eventSubscriptionsRef.current) subscription.attach(r)

    return () => {
      for (const subscription of eventSubscriptionsRef.current) subscription.detach()
      unsubscribe()
      r.dispose()
      if (resurrectRef.current === r) resurrectRef.current = null
    }
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
    let unsubscribe: (() => void) | null = null
    const subscription: PendingEventSubscription = {
      attach(instance) {
        unsubscribe = instance.on(event, listener)
      },
      detach() {
        unsubscribe?.()
        unsubscribe = null
      },
    }
    eventSubscriptionsRef.current.add(subscription)
    if (resurrectRef.current) subscription.attach(resurrectRef.current)
    return () => {
      subscription.detach()
      eventSubscriptionsRef.current.delete(subscription)
    }
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

  const storeRef = useRef<SubscriptionStore<SorobanResurrectContextValue> | null>(null)
  if (storeRef.current === null) {
    storeRef.current = createSubscriptionStore(value)
  }
  const store = storeRef.current

  useEffect(() => {
    store.setSnapshot(value)
  }, [store, value])

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
