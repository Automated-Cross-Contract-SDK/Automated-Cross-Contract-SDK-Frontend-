import type { TransactionHistory } from './TransactionHistory.js'
import type { HistoryStorage } from './types.js'

/** Default storage key used when `persistHistory.key` is not supplied. */
export const DEFAULT_HISTORY_STORAGE_KEY = 'soroban-resurrect:history'

/**
 * Handle returned by {@link attachHistoryPersistence}.
 */
export interface HistoryPersistenceHandle {
  /** Resolves once the initial hydrate from storage has completed. */
  hydrated: Promise<void>
  /** Stops persisting further changes. */
  detach(): void
}

/**
 * Wires a {@link TransactionHistory} to durable storage:
 *
 * 1. Hydrates the history from `storage[key]` (async).
 * 2. Writes the full history back to storage on every subsequent change.
 *
 * Writes are fire-and-forget and de-duplicated per tick so a burst of
 * mutations produces a single `setItem` call. Storage errors are swallowed —
 * persistence is best-effort and must never break the restore workflow.
 */
export function attachHistoryPersistence(
  history: TransactionHistory,
  storage: HistoryStorage,
  key: string = DEFAULT_HISTORY_STORAGE_KEY,
): HistoryPersistenceHandle {
  let detached = false
  let flushQueued = false

  const flush = (): void => {
    if (detached || flushQueued) return
    flushQueued = true
    // Coalesce synchronous bursts into one write.
    Promise.resolve().then(async () => {
      flushQueued = false
      if (detached) return
      try {
        await storage.setItem(key, history.toJSON())
      } catch {
        // best-effort
      }
    })
  }

  const hydrated = (async () => {
    try {
      const raw = await storage.getItem(key)
      if (!detached) history.loadJSON(raw)
    } catch {
      // best-effort — start with an empty history
    }
  })()

  const unsubscribe = history.onChange(flush)

  return {
    hydrated,
    detach() {
      detached = true
      unsubscribe()
    },
  }
}
