import { Transaction } from '@stellar/stellar-sdk'
import { ResurrectResult } from './types.js'
import { asHistoryEntryId, type HistoryEntryId } from './branded-types.js'

/**
 * Status of a single restore attempt.
 *
 * - `pending`  — the attempt has been recorded but not yet completed
 * - `success`  — the restore (and original) transaction completed successfully
 * - `failed`   — the attempt resulted in an error
 */
export type TransactionAttemptStatus = 'pending' | 'success' | 'failed'

/**
 * A single entry in the transaction history log.
 */
export interface TransactionHistoryEntry {
  /** Unique identifier for this history entry (UUID v4). */
  id: HistoryEntryId
  /** Unix timestamp (ms) when the entry was first created. */
  timestamp: number
  /** The original transaction that was submitted (or attempted). */
  transaction: Transaction
  /** The result of the most recent attempt, or null if still pending. */
  result: ResurrectResult | null
  /** Current status of this entry. */
  status: TransactionAttemptStatus
  /** Total number of attempts made for this entry (including retries). */
  attemptCount: number
  /** Unix timestamp (ms) of the most recent attempt. */
  lastAttemptAt: number
}

/**
 * Manages a log of restore attempt history entries.
 *
 * Each call to `submitWithRestore` creates a new entry via `add()`.
 * When the attempt finishes — successfully or not — `update()` records
 * the result and updates the status accordingly.
 *
 * @example
 * ```ts
 * const history = new TransactionHistory()
 * const id = history.add(tx)
 * // ... perform restore ...
 * history.update(id, result)
 * console.log(history.getAll())
 * ```
 */
/**
 * Serialisable form of a {@link TransactionHistoryEntry}. The `transaction`
 * field is stored as a base64 XDR envelope so it can be rebuilt after a restart.
 */
export interface SerializedHistoryEntry {
  id: string
  timestamp: number
  transactionXdr: string
  result: ResurrectResult | null
  status: TransactionAttemptStatus
  attemptCount: number
  lastAttemptAt: number
}

export class TransactionHistory {
  private entries: Map<string, TransactionHistoryEntry> = new Map()

  /** Called after any mutation so persistence layers can flush. */
  private changeListeners: Set<() => void> = new Set()

  /**
   * @param networkPassphrase - Network passphrase used to rebuild `Transaction`
   *   objects from stored XDR during {@link loadJSON}. Required only when
   *   history persistence is enabled.
   */
  constructor(private readonly networkPassphrase?: string) {}

  /**
   * Registers a listener invoked after every mutation (`add`, `update`,
   * `incrementAttempt`, `clear`, `loadJSON`). Returns an unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      listener()
    }
  }

  /**
   * Adds a new pending entry for the given transaction and returns its id.
   *
   * If an existing entry for the same transaction is being retried, use
   * `incrementAttempt()` instead. This method always creates a fresh entry.
   *
   * @param transaction - The transaction to record.
   * @returns The generated entry id.
   */
  add(transaction: Transaction): HistoryEntryId {
    const id = this.generateId()
    const now = Date.now()
    const entry: TransactionHistoryEntry = {
      id,
      timestamp: now,
      transaction,
      result: null,
      status: 'pending',
      attemptCount: 1,
      lastAttemptAt: now,
    }
    this.entries.set(id, entry)
    this.emitChange()
    return id
  }

  /**
   * Updates an existing entry with the result of an attempt.
   *
   * Sets `status` to `'success'` or `'failed'` based on `result.success`
   * and stores the full result object.
   *
   * @param id - The entry id returned by `add()`.
   * @param result - The result from `submitWithRestore`.
   */
  update(id: HistoryEntryId, result: ResurrectResult): void {
    const entry = this.entries.get(id)
    if (!entry) {
      return
    }
    entry.result = result
    entry.status = result.success ? 'success' : 'failed'
    entry.lastAttemptAt = Date.now()
    this.entries.set(id, entry)
    this.emitChange()
  }

  /**
   * Increments the attempt count and resets the entry to `pending` status
   * so a retry can be tracked correctly.
   *
   * @param id - The entry id to increment.
   */
  incrementAttempt(id: HistoryEntryId): void {
    const entry = this.entries.get(id)
    if (!entry) {
      return
    }
    entry.attemptCount += 1
    entry.status = 'pending'
    entry.result = null
    entry.lastAttemptAt = Date.now()
    this.entries.set(id, entry)
    this.emitChange()
  }

  /**
   * Retrieves a single entry by id.
   *
   * @param id - The entry id.
   * @returns The entry, or `undefined` if not found.
   */
  get(id: HistoryEntryId): TransactionHistoryEntry | undefined {
    return this.entries.get(id)
  }

  /**
   * Returns all history entries in insertion order.
   */
  getAll(): TransactionHistoryEntry[] {
    return Array.from(this.entries.values())
  }

  /**
   * Returns all entries that match the given status.
   *
   * @param status - The status to filter by.
   */
  getByStatus(status: TransactionAttemptStatus): TransactionHistoryEntry[] {
    return this.getAll().filter((entry) => entry.status === status)
  }

  /**
   * Removes all entries from the history.
   */
  clear(): void {
    this.entries.clear()
    this.emitChange()
  }

  /**
   * Serialises all entries to a JSON string. Transactions are stored as base64
   * XDR envelopes. Pair with {@link loadJSON} to restore after a restart.
   */
  toJSON(): string {
    const serialized: SerializedHistoryEntry[] = this.getAll().map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      transactionXdr: entry.transaction.toXDR(),
      result: entry.result,
      status: entry.status,
      attemptCount: entry.attemptCount,
      lastAttemptAt: entry.lastAttemptAt,
    }))
    return JSON.stringify(serialized)
  }

  /**
   * Replaces the current entries with those decoded from a string produced by
   * {@link toJSON}. Malformed input is ignored (history stays empty). Requires
   * a `networkPassphrase` to have been passed to the constructor so stored XDR
   * can be rebuilt into `Transaction` objects.
   *
   * @param json - Serialised history string, or `null` (no-op).
   */
  loadJSON(json: string | null): void {
    if (!json) return
    let parsed: SerializedHistoryEntry[]
    try {
      parsed = JSON.parse(json) as SerializedHistoryEntry[]
    } catch {
      return
    }
    if (!Array.isArray(parsed)) return
    if (!this.networkPassphrase) {
      throw new Error(
        'TransactionHistory.loadJSON requires a networkPassphrase to rebuild stored transactions',
      )
    }
    this.entries.clear()
    for (const item of parsed) {
      try {
        const transaction = new Transaction(item.transactionXdr, this.networkPassphrase)
        this.entries.set(item.id, {
          id: asHistoryEntryId(item.id),
          timestamp: item.timestamp,
          transaction,
          result: item.result,
          status: item.status,
          attemptCount: item.attemptCount,
          lastAttemptAt: item.lastAttemptAt,
        })
      } catch {
        // Skip entries whose XDR can no longer be decoded.
      }
    }
    this.emitChange()
  }

  /**
   * Returns the total number of entries in the history.
   */
  get size(): number {
    return this.entries.size
  }

  /**
   * Generates a simple unique id using a timestamp and random suffix.
   * Using a custom generator avoids the need for an external `uuid` dependency.
   *
   * @private
   */
  private generateId(): HistoryEntryId {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).slice(2, 10)
    return asHistoryEntryId(`${timestamp}-${random}`)
  }
}
