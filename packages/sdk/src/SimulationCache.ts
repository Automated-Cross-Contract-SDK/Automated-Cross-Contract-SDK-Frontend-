import { Transaction } from '@stellar/stellar-sdk'
import type { SimulateResponse } from './types.js'
import { extractXdrOperations } from './Restorer.js'

/** Hit/miss/eviction counters exposed by {@link SimulationCache.stats}. */
export interface SimulationCacheStats {
  hits: number
  misses: number
  /** Entries dropped to stay within `maxSize` (TTL expiries are not counted). */
  evictions: number
  size: number
}

/**
 * Least-recently-used simulation cache keyed by a fingerprint of the transaction.
 *
 * `get`, `set` and eviction are all O(1): recency is tracked by `Map`
 * insertion order, and a hit re-inserts the entry so hot transactions
 * survive a stream of one-shot ones.
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
/** Memoized fingerprints per immutable `Transaction` instance (#424). */
const fingerprintMemo = new WeakMap<Transaction, string>()

/**
 * Computes the cache fingerprint once per `Transaction` instance. Envelopes
 * are immutable, so a rebuilt transaction (new instance) gets a fresh
 * fingerprint. Pass the result to `get`/`set` to share it across a workflow
 * step (e.g. detection and estimation).
 */
export function memoizedFingerprint(cache: SimulationCache, transaction: Transaction): string {
  let fp = fingerprintMemo.get(transaction)
  if (fp === undefined) {
    fp = cache.fingerprint(transaction)
    fingerprintMemo.set(transaction, fp)
  }
  return fp
}

export class SimulationCache {
  private readonly maxSize: number
  private readonly ttlMs: number
  private readonly store: Map<string, { response: SimulateResponse; timestamp: number }>
  private hits = 0
  private misses = 0
  private evictions = 0

  constructor(opts?: { maxSize?: number; ttlMs?: number }) {
    const maxSize = opts?.maxSize ?? 50
    const ttlMs = opts?.ttlMs ?? 30_000
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error(`Invalid SimulationCache maxSize: ${maxSize}. Must be a positive integer.`)
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error(`Invalid SimulationCache ttlMs: ${ttlMs}. Must be a positive number.`)
    }
    this.maxSize = maxSize
    this.ttlMs = ttlMs
    this.store = new Map()
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this.store.size
  }

  /** Snapshot of cache hit, miss and eviction counters. */
  stats(): SimulationCacheStats {
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, size: this.store.size }
  }

  /**
   * Computes a stable fingerprint for a transaction.
   *
   * Uses the source account, the operations XDR, the fee, the network
   * passphrase, the Soroban transaction data (footprint and resources), and
   * optionally the timeout duration — but intentionally
   * **excludes the sequence number and absolute timestamp** so that the
   * same logical transaction rebuilt with a fresh sequence or built at a
   * different wall-clock time can hit the cache.
   *
   * Pure (no memoization) so it stays directly unit-testable; `get`/`set`
   * use {@link memoizedFingerprint} so the envelope is walked at most once
   * per transaction instance.
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

    // Include the Soroban footprint so otherwise-identical invocations that
    // touch different ledger entries never share a cached verdict.
    let sorobanData = ''
    try {
      const ext = transaction.toEnvelope().v1().tx().ext()
      if (ext.switch() === 1) sorobanData = ext.sorobanData().toXDR('base64')
    } catch {
      // Non-v1 envelopes carry no Soroban data.
    }

    const parts = [
      transaction.source,
      opsXdr,
      sorobanData,
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
  get(transaction: Transaction, fingerprint?: string): SimulateResponse | undefined {
    const key = fingerprint ?? memoizedFingerprint(this, transaction)
    const entry = this.store.get(key)

    if (!entry || Date.now() - entry.timestamp > this.ttlMs) {
      if (entry) this.store.delete(key)
      this.misses++
      return undefined
    }

    // Refresh recency: move the entry to the most-recently-used end.
    this.store.delete(key)
    this.store.set(key, entry)
    this.hits++
    return entry.response
  }

  /**
   * Stores a simulation response for the given transaction.
   * If the cache exceeds `maxSize`, the least-recently-used entry is evicted.
   */
  set(transaction: Transaction, response: SimulateResponse, fingerprint?: string): void {
    const key = fingerprint ?? memoizedFingerprint(this, transaction)

    if (this.store.has(key)) {
      this.store.delete(key)
    } else if (this.store.size >= this.maxSize) {
      // Evict the least-recently-used entry (first key in insertion order)
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) {
        this.store.delete(oldest)
        this.evictions++
      }
    }

    this.store.set(key, { response, timestamp: Date.now() })
  }

  /** Clears all cached entries. */
  clear(): void {
    this.store.clear()
    this.hits = 0
    this.misses = 0
    this.evictions = 0
  }
}
