import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  LedgerEntryTTLInfo,
  ResurrectResult,
  WalletAdapter,
} from '@soroban-resurrect/sdk'
import type { Transaction, xdr } from '@stellar/stellar-sdk'
import {
  useResolvedResurrect,
  type ResolvedResurrectOptions,
} from './useResolvedResurrect.js'

/** Lifecycle status of the watcher. */
export type RestoreWatchStatus = 'idle' | 'watching' | 'stopped' | 'error'

/** Options for the `useRestoreWatcher` hook. */
export interface UseRestoreWatcherOptions extends ResolvedResurrectOptions {
  /** Poll interval in milliseconds. Defaults to `30_000`. */
  intervalMs?: number
  /**
   * "Expiring soon" cutoff, in ledgers remaining. Forwarded to
   * `SorobanResurrect.getExpiringSoonEntries`. Defaults to `100_000`
   * (~5.8 days at ~5 s/ledger).
   */
  ledgersThreshold?: number
  /** Start polling immediately on mount. Defaults to `true`. */
  autoStart?: boolean
  /** Called after every poll tick with the current expiring-soon entries. */
  onTick?: (expiringSoon: LedgerEntryTTLInfo[]) => void
  /**
   * Called when the set of expiring-soon entries becomes non-empty
   * (transition from "nothing expiring" to "something expiring").
   */
  onExpiringSoon?: (expiringSoon: LedgerEntryTTLInfo[]) => void
  /**
   * Custom extension routine invoked by `extend()`. Receives the entries
   * currently expiring. If omitted, `extend()` falls back to
   * `submitWithRestore` and requires a `transaction` + `wallet`.
   */
  onExtend?: (expiringSoon: LedgerEntryTTLInfo[]) => Promise<void>
}

/** Return value of the `useRestoreWatcher` hook. */
export interface UseRestoreWatcherReturn {
  /** Entries expiring within `ledgersThreshold` (or already archived). */
  expiringSoon: LedgerEntryTTLInfo[]
  /** Current watcher status. */
  watchStatus: RestoreWatchStatus
  /** Timestamp (ms) of the last completed poll, or `null`. */
  lastCheckedAt: number | null
  /** Error message from the most recent failed poll/extend, or `null`. */
  error: string | null
  /** Begin polling (no-op if already watching). */
  start: () => void
  /** Stop polling. Also runs automatically on unmount. */
  stop: () => void
  /** Cancel active fallback extension workflows started by this hook. */
  cancel: () => boolean
  /** Force an immediate poll, independent of the interval. */
  refresh: () => Promise<void>
  /**
   * Trigger a TTL extension. Uses `options.onExtend` when provided,
   * otherwise `submitWithRestore({ transaction, wallet })`. Re-polls on
   * success. Returns the `ResurrectResult` for the fallback path, or `null`
   * when `onExtend` handled it.
   */
  extend: (transaction?: Transaction, wallet?: WalletAdapter) => Promise<ResurrectResult | null>
}

/**
 * React binding for the SDK's proactive "watch-and-extend" pattern. Polls
 * `SorobanResurrect.getExpiringSoonEntries` on an interval so a component can
 * render "your position expires soon" and offer a one-click extension.
 *
 * The poll timer is tied to the component lifecycle: it starts on mount
 * (unless `autoStart: false`) and is always cleared on unmount, so an
 * unmounted component never keeps polling.
 *
 * @param keys - Ledger keys to monitor.
 * @param options - See {@link UseRestoreWatcherOptions}.
 *
 * @example
 * ```tsx
 * const { expiringSoon, extend } = useRestoreWatcher(keys, {
 *   config,
 *   intervalMs: 15_000,
 *   onExtend: async () => { await myRestoreFlow() },
 * })
 * ```
 */
export function useRestoreWatcher(
  keys: xdr.LedgerKey[],
  options: UseRestoreWatcherOptions = {},
): UseRestoreWatcherReturn {
  const {
    intervalMs = 30_000,
    ledgersThreshold = 100_000,
    autoStart = true,
  } = options

  const resurrect = useResolvedResurrect(options)

  const [expiringSoon, setExpiringSoon] = useState<LedgerEntryTTLInfo[]>([])
  const [watchStatus, setWatchStatus] = useState<RestoreWatchStatus>('idle')
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const keysRef = useRef(keys)
  keysRef.current = keys
  const optsRef = useRef(options)
  optsRef.current = options
  const hadExpiringRef = useRef(false)
  const mountedRef = useRef(false)
  const extensionControllersRef = useRef(new Set<AbortController>())

  const poll = useCallback(async () => {
    if (!mountedRef.current) return
    try {
      const entries = await resurrect.getExpiringSoonEntries(
        keysRef.current,
        ledgersThreshold,
      )
      if (!mountedRef.current) return
      setExpiringSoon(entries)
      setLastCheckedAt(Date.now())
      setError(null)
      optsRef.current.onTick?.(entries)
      if (entries.length > 0 && !hadExpiringRef.current) {
        optsRef.current.onExpiringSoon?.(entries)
      }
      hadExpiringRef.current = entries.length > 0
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : String(err))
      setWatchStatus('error')
    }
  }, [resurrect, ledgersThreshold])

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mountedRef.current) setWatchStatus((s) => (s === 'error' ? s : 'stopped'))
  }, [])

  const start = useCallback(() => {
    if (!mountedRef.current) return
    if (timerRef.current !== null) return
    setWatchStatus('watching')
    void poll()
    timerRef.current = setInterval(() => {
      void poll()
    }, intervalMs)
  }, [poll, intervalMs])

  const cancel = useCallback(() => {
    let cancelled = false
    for (const controller of extensionControllersRef.current) {
      if (!controller.signal.aborted) {
        controller.abort()
        cancelled = true
      }
    }
    return cancelled
  }, [])

  const extend = useCallback(
    async (
      transaction?: Transaction,
      wallet?: WalletAdapter,
    ): Promise<ResurrectResult | null> => {
      if (!mountedRef.current) return null
      setError(null)
      const controller = new AbortController()
      try {
        if (optsRef.current.onExtend) {
          await optsRef.current.onExtend(expiringSoon)
          if (mountedRef.current) await poll()
          return null
        }
        if (!transaction || !wallet) {
          throw new Error(
            'useRestoreWatcher.extend: provide `onExtend`, or pass a transaction and wallet.',
          )
        }
        extensionControllersRef.current.add(controller)
        const result = await resurrect.submitWithRestore({
          transaction,
          wallet,
          signal: controller.signal,
        })
        if (mountedRef.current && !result.success) setError(result.error ?? 'Extension failed')
        if (mountedRef.current) await poll()
        return result
      } catch (err) {
        if (mountedRef.current) setError(err instanceof Error ? err.message : String(err))
        throw err
      } finally {
        extensionControllersRef.current.delete(controller)
      }
    },
    [resurrect, poll, expiringSoon],
  )

  // Bind polling to the component lifecycle; always clean up on unmount.
  useEffect(() => {
    mountedRef.current = true
    if (autoStart) start()
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, autoStart, cancel])

  return {
    expiringSoon,
    watchStatus,
    lastCheckedAt,
    error,
    start,
    stop,
    cancel,
    refresh: poll,
    extend,
  }
}
