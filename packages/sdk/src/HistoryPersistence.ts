import type { TransactionHistory, MinimalHistoryEntry } from './TransactionHistory.js'
import type { HistoryStorage } from './types.js'

/**
 * What {@link attachHistoryPersistence} writes to storage.
 *
 * - `'minimal'` (**recommended**): per entry only `id`, `timestamp`, `status`,
 *   `attemptCount`, `lastAttemptAt` and the transaction hash. No XDR, no
 *   results. Entries are not rehydrated into the live history (they cannot be
 *   rebuilt into `Transaction` objects); read them with {@link parseMinimalHistory}.
 * - `'full'` (default, for backwards compatibility): per entry `id`,
 *   `timestamp`, the full signed-envelope `transactionXdr`, the complete
 *   `ResurrectResult`, `status`, `attemptCount` and `lastAttemptAt`. XDR
 *   discloses contract ids, ledger keys, amounts and counterparties.
 *
 * In both modes data stays in `storage` until the key is overwritten or
 * removed — with `localStorage` that means indefinitely, readable by any
 * script on the origin. Use a {@link HistorySerializer} to encrypt it.
 */
export type HistoryPersistenceMode = 'full' | 'minimal'

/**
 * Transforms the serialised history on its way to/from storage — e.g. to
 * encrypt it or forward it to a server-side store.
 */
export interface HistorySerializer {
  serialize(plain: string): string | Promise<string>
  deserialize(stored: string): string | Promise<string>
}

/** Extra options for {@link attachHistoryPersistence}. */
export interface AttachHistoryPersistenceOptions {
  /** Defaults to `'full'`; `'minimal'` is recommended. */
  mode?: HistoryPersistenceMode
  serializer?: HistorySerializer
}

/** Parses a blob written in `'minimal'` mode. Returns `[]` on malformed input. */
export function parseMinimalHistory(json: string | null): MinimalHistoryEntry[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as MinimalHistoryEntry[]) : []
  } catch {
    return []
  }
}

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
 * 2. Writes the history back to storage on every subsequent change — the
 *    full entries by default, or a redacted record in `'minimal'` mode
 *    (see {@link HistoryPersistenceMode} for exactly which fields are written).
 *
 * Writes are fire-and-forget and de-duplicated per tick so a burst of
 * mutations produces a single `setItem` call. Storage errors are swallowed —
 * persistence is best-effort and must never break the restore workflow.
 */
export function attachHistoryPersistence(
  history: TransactionHistory,
  storage: HistoryStorage,
  key: string = DEFAULT_HISTORY_STORAGE_KEY,
  options: AttachHistoryPersistenceOptions = {},
): HistoryPersistenceHandle {
  const mode = options.mode ?? 'full'
  const serializer = options.serializer
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
        const plain = mode === 'minimal' ? history.toMinimalJSON() : history.toJSON()
        await storage.setItem(key, serializer ? await serializer.serialize(plain) : plain)
      } catch {
        // best-effort
      }
    })
  }

  const hydrated = (async () => {
    try {
      // Minimal records can't be rebuilt into Transactions; nothing to hydrate.
      if (mode === 'minimal') return
      const stored = await storage.getItem(key)
      const raw = stored && serializer ? await serializer.deserialize(stored) : stored
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
