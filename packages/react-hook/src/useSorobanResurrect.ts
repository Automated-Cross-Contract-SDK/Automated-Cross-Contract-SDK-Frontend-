import { useState, useCallback, useRef, useEffect } from 'react'
import {
  SorobanResurrect,
  type SorobanResurrectConfig,
  type WalletAdapter,
  type RestoreStateInfo,
  type ArchivedLedgerEntry,
  type ResurrectResult,
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
  /** Reset state back to idle. */
  reset: () => void
  /** The underlying SDK instance. */
  resurrect: SorobanResurrect
}

/**
 * Standalone hook that creates and manages a `SorobanResurrect` instance.
 * Subscribes to state changes and exposes the full API. Unlike the context
 * provider pattern, this hook manages its own instance and is suitable for
 * use in components that are not wrapped in `SorobanResurrectProvider`.
 */
export function useSorobanResurrect(
  options: UseSorobanResurrectOptions,
): UseSorobanResurrectReturn {
  const { config } = options
  const resurrectRef = useRef<SorobanResurrect | null>(null)
  const [state, setState] = useState<RestoreStateInfo>({
    state: 'idle',
    message: '',
  })

  if (!resurrectRef.current) {
    resurrectRef.current = new SorobanResurrect(config)
  }

  useEffect(() => {
    const r = resurrectRef.current!
    const unsub = r.onStateChange((info: RestoreStateInfo) => {
      setState(info)
    })
    return unsub
  }, [])

  const submitWithRestore = useCallback(async (transaction: Transaction, wallet: WalletAdapter) => {
    return resurrectRef.current!.submitWithRestore({ transaction, wallet })
  }, [])

  const detectArchivedKeys = useCallback(async (transaction: Transaction) => {
    return resurrectRef.current!.detectArchivedKeys(transaction)
  }, [])

  const reset = useCallback(() => {
    resurrectRef.current!.reset()
    setState({ state: 'idle', message: '' })
  }, [])

  const isProcessing =
    state.state === 'simulating' ||
    state.state === 'signing_restore' ||
    state.state === 'submitting_restore' ||
    state.state === 'confirming_restore' ||
    state.state === 'signing_original' ||
    state.state === 'submitting_original'

  return {
    state,
    isProcessing,
    submitWithRestore,
    detectArchivedKeys,
    reset,
    resurrect: resurrectRef.current,
  }
}
