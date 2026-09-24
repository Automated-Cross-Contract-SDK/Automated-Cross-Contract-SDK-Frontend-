import {
  ref,
  onMounted,
  onUnmounted,
  toValue,
  type Ref,
  type MaybeRefOrGetter,
} from 'vue'
import type {
  LedgerEntryTTLInfo,
  ResurrectResult,
  WalletAdapter,
} from '@soroban-resurrect/sdk'
import type { Transaction, xdr } from '@stellar/stellar-sdk'
import { resolveResurrect, type ResolveResurrectOptions } from './resolveResurrect.js'

/** Lifecycle status of the watcher. */
export type RestoreWatchStatus = 'idle' | 'watching' | 'stopped' | 'error'

/** Options for `useSorobanResurrectWatcher`. */
export interface UseSorobanResurrectWatcherOptions extends ResolveResurrectOptions {
  /** Poll interval in milliseconds. Defaults to `30_000`. */
  intervalMs?: number
  /** "Expiring soon" cutoff in ledgers remaining. Defaults to `100_000`. */
  ledgersThreshold?: number
  /** Start polling on mount. Defaults to `true`. */
  autoStart?: boolean
  /** Called after each poll with the current expiring-soon entries. */
  onTick?: (expiringSoon: LedgerEntryTTLInfo[]) => void
  /** Called once when the expiring-soon set transitions from empty to non-empty. */
  onExpiringSoon?: (expiringSoon: LedgerEntryTTLInfo[]) => void
  /** Custom extension routine invoked by `extend()`. */
  onExtend?: (expiringSoon: LedgerEntryTTLInfo[]) => Promise<void>
}

/** Return value of `useSorobanResurrectWatcher`. */
export interface UseSorobanResurrectWatcherReturn {
  /** Entries expiring within `ledgersThreshold` (or already archived). */
  expiringSoon: Ref<LedgerEntryTTLInfo[]>
  /** Current watcher status. */
  watchStatus: Ref<RestoreWatchStatus>
  /** Timestamp (ms) of the last completed poll, or `null`. */
  lastCheckedAt: Ref<number | null>
  /** Error from the most recent failed poll/extend, or `null`. */
  error: Ref<string | null>
  /** Begin polling (no-op if already running). */
  start: () => void
  /** Stop polling. Runs automatically on unmount. */
  stop: () => void
  /** Force an immediate poll. */
  refresh: () => Promise<void>
  /**
   * Trigger a TTL extension. Uses `options.onExtend` when provided, otherwise
   * `submitWithRestore({ transaction, wallet })`. Re-polls on success.
   */
  extend: (
    transaction?: Transaction,
    wallet?: WalletAdapter,
  ) => Promise<ResurrectResult | null>
}

/**
 * Vue composable binding the SDK's proactive "watch-and-extend" pattern. Polls
 * `SorobanResurrect.getExpiringSoonEntries` on an interval so a component can
 * render an "expiring soon" warning and offer one-click extension.
 *
 * SSR-safe: polling starts in `onMounted` and is always cleared in
 * `onUnmounted`, so an unmounted (or server-rendered) component never polls.
 * Mirrors the React `useRestoreWatcher` semantics.
 *
 * @param keys - Ledger keys to monitor (ref/getter or plain array).
 * @param options - See {@link UseSorobanResurrectWatcherOptions}.
 */
export function useSorobanResurrectWatcher(
  keys: MaybeRefOrGetter<xdr.LedgerKey[]>,
  options: UseSorobanResurrectWatcherOptions,
): UseSorobanResurrectWatcherReturn {
  const {
    intervalMs = 30_000,
    ledgersThreshold = 100_000,
    autoStart = true,
  } = options

  const resurrect = resolveResurrect(options)

  const expiringSoon = ref<LedgerEntryTTLInfo[]>([])
  const watchStatus = ref<RestoreWatchStatus>('idle')
  const lastCheckedAt = ref<number | null>(null)
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setInterval> | null = null
  let hadExpiring = false

  const poll = async (): Promise<void> => {
    const instance = resurrect.value
    if (!instance) return
    try {
      const entries = await instance.getExpiringSoonEntries(
        toValue(keys),
        ledgersThreshold,
      )
      expiringSoon.value = entries
      lastCheckedAt.value = Date.now()
      error.value = null
      options.onTick?.(entries)
      if (entries.length > 0 && !hadExpiring) {
        options.onExpiringSoon?.(entries)
      }
      hadExpiring = entries.length > 0
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      watchStatus.value = 'error'
    }
  }

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    if (watchStatus.value !== 'error') watchStatus.value = 'stopped'
  }

  const start = (): void => {
    if (timer !== null) return
    watchStatus.value = 'watching'
    void poll()
    timer = setInterval(() => {
      void poll()
    }, intervalMs)
  }

  const extend = async (
    transaction?: Transaction,
    wallet?: WalletAdapter,
  ): Promise<ResurrectResult | null> => {
    const instance = resurrect.value
    error.value = null
    try {
      if (options.onExtend) {
        await options.onExtend(expiringSoon.value)
        await poll()
        return null
      }
      if (!instance || !transaction || !wallet) {
        throw new Error(
          'useSorobanResurrectWatcher.extend: provide `onExtend`, or pass a transaction and wallet.',
        )
      }
      const result = await instance.submitWithRestore({ transaction, wallet })
      if (!result.success) error.value = result.error ?? 'Extension failed'
      await poll()
      return result
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  onMounted(() => {
    if (autoStart) start()
  })

  onUnmounted(() => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  })

  return {
    expiringSoon,
    watchStatus,
    lastCheckedAt,
    error,
    start,
    stop,
    refresh: poll,
    extend,
  }
}
