import { writable, derived, get, type Readable, type Writable } from 'svelte/store'
import {
  SorobanResurrect,
  isProcessingState,
  RESTORE_FEE_MULTIPLIER,
  type SorobanResurrectConfig,
  type WalletAdapter,
  type RestoreStateInfo,
  type RestoreState,
  type ArchivedLedgerEntry,
  type ResurrectResult,
  type SorobanResurrectEvents,
} from '@soroban-resurrect/sdk'
import type { Transaction } from '@stellar/stellar-sdk'

/** A rough restore fee estimate produced by {@link SorobanResurrectStore.estimate}. */
export interface FeeEstimate {
  /** Number of archived ledger entries that would need restoring. */
  archivedKeysDetected: number
  /** Minimum resource fee reported by simulation, in stroops. */
  minResourceFee: string
  /** Suggested restore fee (minResourceFee × multiplier), in stroops. */
  estimatedRestoreFee: string
  /** Fee multiplier applied to `minResourceFee`. */
  multiplier: number
}

/** State of a single item within a {@link SorobanResurrectStore.submitBatch} call. */
export interface BatchItemState {
  /** Current status of this item. */
  status: 'pending' | 'submitting' | 'success' | 'error'
  /** The result once the item settles, or `null` while pending/submitting. */
  result: ResurrectResult | null
}

/** Return value of {@link SorobanResurrectStore.submitBatch}. */
export interface BatchSubmission {
  /** One reactive store per input item, in input order. */
  items: Readable<BatchItemState>[]
  /** Resolves with every per-item result once the whole batch settles. */
  done: Promise<ResurrectResult[]>
}

/** Return value of `createSorobanResurrect`. */
export interface SorobanResurrectStore {
  /** Reactive store of current workflow state. */
  state: Readable<RestoreStateInfo>
  /** Whether a restore/submit operation is in progress. */
  isProcessing: Readable<boolean>
  /**
   * Archived keys for the current workflow. Only populated once the SDK reaches
   * `restore_needed` (or a later) state; empty otherwise.
   */
  archivedKeys: Readable<ArchivedLedgerEntry[]>
  /** The most recent {@link ResurrectResult}, or `null` before the first submit. */
  lastResult: Readable<ResurrectResult | null>
  /** The most recent fee estimate produced by `estimate()`, or `null`. */
  feeEstimate: Readable<FeeEstimate | null>
  /** Submit a transaction with automatic archive restoration. */
  submitWithRestore: (transaction: Transaction, wallet: WalletAdapter) => Promise<ResurrectResult>
  /**
   * Submit several transactions sequentially with automatic archive restoration.
   * Wraps `submitBatchWithRestore` and exposes a per-item result store.
   */
  submitBatch: (items: SubmitWithRestoreOptions[]) => BatchSubmission
  /** Check if a transaction requires archive restoration. */
  detectArchivedKeys: (transaction: Transaction) => Promise<ArchivedLedgerEntry[]>
  /** Estimate the restore fee for a transaction and update the `feeEstimate` store. */
  estimate: (transaction: Transaction) => Promise<FeeEstimate>
  /** Reset state back to idle. Optionally, only reset if in a specific state. */
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
 *   const { state, archivedKeys, feeEstimate, lastResult, submitBatch, reset, destroy } =
 *     createSorobanResurrect(config)
 *
 *   onDestroy(destroy)
 * </script>
 *
 * {$state.message}
 * {#if $archivedKeys.length}{$archivedKeys.length} entries archived{/if}
 * {#if $feeEstimate}~{$feeEstimate.estimatedRestoreFee} stroops{/if}
 * <button on:click={reset}>Reset</button>
 * ```
 */
export function createSorobanResurrect(
  configStore: Readable<SorobanResurrectConfig>,
): SorobanResurrectStore {
  const stateWritable: Writable<RestoreStateInfo> = writable({ state: 'idle', message: '' })
  const lastResultWritable: Writable<ResurrectResult | null> = writable(null)
  const feeEstimateWritable: Writable<FeeEstimate | null> = writable(null)
  let resurrect: SorobanResurrect
  let currentConfig: SorobanResurrectConfig
  let unsubscribeState: (() => void) | null = null

  // React to config store changes — recreate SDK when config updates
  const unsubscribeConfig = configStore.subscribe((newConfig) => {
    currentConfig = newConfig

    // Clean up previous SDK subscription
    if (unsubscribeState) {
      unsubscribeState()
      unsubscribeState = null
    }

    resurrect = new SorobanResurrect(newConfig)
    stateWritable.set({ state: 'idle', message: '' })
    lastResultWritable.set(null)
    feeEstimateWritable.set(null)

    unsubscribeState = resurrect.onStateChange((info: RestoreStateInfo) => {
      stateWritable.set(info)
    })
  })

  const isProcessing = derived(stateWritable, ($state) => isProcessingState($state.state))

  // Only surface archived keys once they are known (restore_needed and later).
  const archivedKeys = derived(stateWritable, ($state) => $state.archivedKeys ?? [])

  const submitWithRestore = async (
    transaction: Transaction,
    wallet: WalletAdapter,
  ): Promise<ResurrectResult> => {
    const result = await resurrect.submitWithRestore({ transaction, wallet })
    lastResultWritable.set(result)
    return result
  }

  const submitBatch = (items: SubmitWithRestoreOptions[]): BatchSubmission => {
    const itemStores = items.map(() =>
      writable<BatchItemState>({ status: 'pending', result: null }),
    )

    const done = (async () => {
      const results: ResurrectResult[] = []
      for (let i = 0; i < items.length; i++) {
        itemStores[i].set({ status: 'submitting', result: null })
        const result = await resurrect.submitWithRestore(items[i])
        itemStores[i].set({
          status: result.success ? 'success' : 'error',
          result,
        })
        lastResultWritable.set(result)
        results.push(result)
      }
      return results
    })()

    return {
      items: itemStores.map((s) => ({ subscribe: s.subscribe })),
      done,
    }
  }

  const detectArchivedKeys = async (transaction: Transaction): Promise<ArchivedLedgerEntry[]> => {
    return resurrect.detectArchivedKeys(transaction)
  }

  const estimate = async (transaction: Transaction): Promise<FeeEstimate> => {
    const [archived, sim] = await Promise.all([
      resurrect.detectArchivedKeys(transaction),
      resurrect.simulate(transaction),
    ])
    const minResourceFee =
      'minResourceFee' in sim && sim.minResourceFee ? String(sim.minResourceFee) : '0'
    const multiplier = currentConfig.restoreFeeMultiplier ?? RESTORE_FEE_MULTIPLIER
    const estimateResult: FeeEstimate = {
      archivedKeysDetected: archived.length,
      minResourceFee,
      estimatedRestoreFee: (Number(minResourceFee) * multiplier).toString(),
      multiplier,
    }
    feeEstimateWritable.set(estimateResult)
    return estimateResult
  }

  const reset = (fromState?: RestoreState) => {
    resurrect.reset(fromState)
    if (get(stateWritable).state === 'idle') {
      feeEstimateWritable.set(null)
    }
  }

  const on = <K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ): (() => void) => {
    return resurrect.on(event, listener)
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
    archivedKeys,
    lastResult: { subscribe: lastResultWritable.subscribe },
    feeEstimate: { subscribe: feeEstimateWritable.subscribe },
    submitWithRestore,
    submitBatch,
    detectArchivedKeys,
    estimate,
    reset,
    on,
    resurrect: resurrect!,
    destroy,
  }
}
