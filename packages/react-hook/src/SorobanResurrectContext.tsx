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
  type SorobanResurrectConfig,
  type WalletAdapter,
  type RestoreStateInfo,
  type ArchivedLedgerEntry,
  type ResurrectResult,
} from '@soroban-resurrect/sdk'
import type { Transaction } from '@stellar/stellar-sdk'

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
  reset: () => void
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
 */
export function SorobanResurrectProvider({ config, children }: SorobanResurrectProviderProps) {
  const resurrectRef = useRef<SorobanResurrect | null>(null)
  const [state, setState] = useState<RestoreStateInfo>({
    state: 'idle',
    message: '',
  })

  const configStr = JSON.stringify(config)
  const prevConfigStr = useRef(configStr)
  if (configStr !== prevConfigStr.current) {
    prevConfigStr.current = configStr
    resurrectRef.current = new SorobanResurrect(config)
  }

  if (!resurrectRef.current) {
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
  }, [configStr])

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

  const reset = useCallback(() => {
    resurrectRef.current?.reset()
    setState({ state: 'idle', message: '' })
  }, [])

  const isProcessing =
    state.state === 'simulating' ||
    state.state === 'signing_restore' ||
    state.state === 'submitting_restore' ||
    state.state === 'confirming_restore' ||
    state.state === 'signing_original' ||
    state.state === 'submitting_original'

  const value: SorobanResurrectContextValue = {
    resurrect: resurrectRef.current,
    config,
    state,
    isProcessing,
    submitWithRestore,
    detectArchivedKeys,
    reset,
  }

  return (
    <SorobanResurrectContext.Provider value={value}>{children}</SorobanResurrectContext.Provider>
  )
}

/**
 * Hook to access the `SorobanResurrect` API from within a
 * `<SorobanResurrectProvider>`. Throws if used outside the provider.
 */
export function useSorobanResurrectContext(): SorobanResurrectContextValue {
  const ctx = useContext(SorobanResurrectContext)
  if (!ctx) {
    throw new Error('useSorobanResurrectContext must be used within a SorobanResurrectProvider')
  }
  return ctx
}
