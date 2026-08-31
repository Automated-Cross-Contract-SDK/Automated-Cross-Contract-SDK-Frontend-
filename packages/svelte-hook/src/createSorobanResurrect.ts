import { writable, derived, type Readable, type Writable } from 'svelte/store'
import {
  SorobanResurrect,
  isProcessingState,
  type SorobanResurrectConfig,
  type WalletAdapter,
  type RestoreStateInfo,
  type RestoreState,
  type ArchivedLedgerEntry,
  type ResurrectResult,
  type SorobanResurrectEvents,
} from '@soroban-resurrect/sdk'
import type { Transaction } from '@stellar/stellar-sdk'

/** Return value of `createSorobanResurrect`. */
export interface SorobanResurrectStore {
  /** Reactive store of current workflow state. */
  state: Readable<RestoreStateInfo>
  /** Whether a restore/submit operation is in progress. */
  isProcessing: Readable<boolean>
  /** Submit a transaction with automatic archive restoration. */
  submitWithRestore: (transaction: Transaction, wallet: WalletAdapter) => Promise<ResurrectResult>
  /** Check if a transaction requires archive restoration. */
  detectArchivedKeys: (transaction: Transaction) => Promise<ArchivedLedgerEntry[]>
  /** Reset state back to idle. Optionally, only reset if in a specific state. */
  reset: (fromState?: RestoreState) => void
  /**
   * Subscribes to a typed SDK lifecycle event. Always binds to the current
   * SDK instance, so it keeps working across a config change that
   * recreates it — unlike destructuring `resurrect` at store-creation time,
   * which captures a single snapshot instance. Returns an unsubscribe
   * function.
   */
  on: <K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ) => () => void
  /** The underlying SDK instance. */
  resurrect: SorobanResurrect
  /** Clean up subscriptions. Call inside Svelte's `onDestroy()`. */
  destroy: () => void
}

/**
 * Creates a Svelte store that wraps a `SorobanResurrect` SDK instance.
 *
 * Subscribes to SDK state changes and exposes the state as a readable Svelte store.
 * Accepts a reactive config store so the SDK is recreated when config changes.
 *
 * **Important:** Call `store.destroy()` in your component's `onDestroy()` to clean up.
 *
 * @example
 * ```svelte
 * <script>
 *   import { onDestroy } from 'svelte'
 *   import { writable } from 'svelte/store'
 *   import { createSorobanResurrect } from '@soroban-resurrect/svelte-hook'
 *
 *   const config = writable({ rpcUrl: 'https://soroban-testnet.stellar.org' })
 *   const { state, isProcessing, submitWithRestore, reset, destroy } = createSorobanResurrect(config)
 *
 *   onDestroy(destroy)
 * </script>
 *
 * {$state.message}
 * <button on:click={reset}>Reset</button>
 * ```
 */
export function createSorobanResurrect(
  configStore: Readable<SorobanResurrectConfig>,
): SorobanResurrectStore {
  const stateWritable: Writable<RestoreStateInfo> = writable({ state: 'idle', message: '' })
  let resurrect: SorobanResurrect
  let unsubscribeState: (() => void) | null = null

  // React to config store changes — recreate SDK when config updates
  const unsubscribeConfig = configStore.subscribe((newConfig) => {
    // Clean up previous SDK subscription
    if (unsubscribeState) {
      unsubscribeState()
      unsubscribeState = null
    }

    resurrect = new SorobanResurrect(newConfig)
    stateWritable.set({ state: 'idle', message: '' })

    unsubscribeState = resurrect.onStateChange((info: RestoreStateInfo) => {
      stateWritable.set(info)
    })
  })

  const isProcessing = derived(stateWritable, ($state) => isProcessingState($state.state))

  const submitWithRestore = async (
    transaction: Transaction,
    wallet: WalletAdapter,
  ): Promise<ResurrectResult> => {
    return resurrect.submitWithRestore({ transaction, wallet })
  }

  const detectArchivedKeys = async (transaction: Transaction): Promise<ArchivedLedgerEntry[]> => {
    return resurrect.detectArchivedKeys(transaction)
  }

  const reset = (fromState?: RestoreState) => {
    resurrect.reset(fromState)
  }

  const on = <K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ) => {
    return resurrect.on(event, listener)
  }

  const destroy = () => {
    if (unsubscribeState) {
      unsubscribeState()
      unsubscribeState = null
    }
    unsubscribeConfig()
  }

  return {
    state: { subscribe: stateWritable.subscribe },
    isProcessing,
    submitWithRestore,
    detectArchivedKeys,
    reset,
    on,
    resurrect: resurrect!,
    destroy,
  }
}
