import { Transaction } from '@stellar/stellar-sdk'
import type { SimulateResponse } from './types.js'
import { extractXdrOperations } from './Restorer.js'

/**
 * Lightweight, LRU-style simulation cache keyed by a fingerprint of the transaction.
 *
 * The fingerprint excludes the sequence number so that rebuilt transactions
 * (which only differ by sequence number) can reuse previous simulation results.
 * Cached entries expire after a configurable TTL to avoid serving stale data.
 *
 * @example
 * ```ts
 * const cache = new SimulationCache({ maxSize: 50, ttlMs: 30_000 })
 * const cached = cache.get(myTx)
 * if (cached) return cached
 * const sim = await server.simulateTransaction(myTx)
 * cache.set(myTx, sim)
 * ```
 */
export class SimulationCache {
  private readonly maxSize: number
  private readonly ttlMs: number
  private readonly store: Map<string, { response: SimulateResponse; timestamp: number }>

  constructor(opts?: { maxSize?: number; ttlMs?: number }) {
    this.maxSize = opts?.maxSize ?? 50
    this.ttlMs = opts?.ttlMs ?? 30_000
    this.store = new Map()
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this.store.size
  }

  /**
   * Computes a stable fingerprint for a transaction.
   *
   * Uses the source account, the operations XDR, the fee, the network
   * passphrase, and optionally the timeout duration — but intentionally
   * **excludes the sequence number and absolute timestamp** so that the
   * same logical transaction rebuilt with a fresh sequence or built at a
   * different wall-clock time can hit the cache.
   */
  fingerprint(transaction: Transaction): string {
    // Extract operations from the XDR envelope so the fingerprint is
    // stable across transactions that differ only by sequence number.
    const ops = extractXdrOperations(transaction)
    const opsXdr = ops.map((op) => op.toXDR('base64')).join(',')

    // Use the timeout duration instead of absolute maxTime so the
    // fingerprint matches even when rebuilt at a different wall-clock time.
    let timeoutSeconds = ''
    if (transaction.timeBounds) {
      const minTime = parseInt(transaction.timeBounds.minTime, 10) || 0
      const maxTime = parseInt(transaction.timeBounds.maxTime, 10) || 0
      if (maxTime > minTime) {
        timeoutSeconds = String(maxTime - minTime)
      }
    }

    const parts = [
      transaction.source,
      opsXdr,
      transaction.fee,
      transaction.networkPassphrase ?? '',
      timeoutSeconds,
    ]
    return parts.join('|')
  }

  /**
   * Retrieves a cached simulation response for the given transaction,
   * or `undefined` if not present or expired.
   */
  get(transaction: Transaction): SimulateResponse | undefined {
    const key = this.fingerprint(transaction)
    const entry = this.store.get(key)

    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.store.delete(key)
      return undefined
    }

    return entry.response
  }

  /**
   * Stores a simulation response for the given transaction.
   * If the cache exceeds `maxSize`, the oldest entry is evicted (FIFO).
   */
  set(transaction: Transaction, response: SimulateResponse): void {
    const key = this.fingerprint(transaction)

    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      // Evict the oldest entry (FIFO — first key in insertion order)
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) {
        this.store.delete(oldest)
      }
    }

    this.store.set(key, { response, timestamp: Date.now() })
  }

  /** Clears all cached entries. */
  clear(): void {
    this.store.clear()
  }
}
