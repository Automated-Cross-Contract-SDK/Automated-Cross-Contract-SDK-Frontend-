import { writable, readable, derived, get, type Readable, type Writable } from 'svelte/store';
import {
  SorobanRestoreClient,
  type RestoreClientOptions,
  type EstimateResult,
  type SubmitBatchResult,
  type EntryKey,
} from '@soroban-restore/core';

export interface SorobanRestoreStoreOptions extends RestoreClientOptions {
  /** Poll interval in milliseconds for the TTL watcher. Defaults to 30_000. */
  watchIntervalMs?: number;
  /** Entries are considered "expiring soon" when their remaining TTL is below this. Defaults to 86_400. */
  expiringThreshold?: number;
}

export type WatchStatus = 'idle' | 'watching' | 'stopped' | 'error';

export interface SorobanRestoreStore {
  /** Readable store of the latest estimate result. */
  estimate: Readable<EstimateResult | null>;
  /** Readable store of the latest batch submission result. */
  submitBatch: Readable<SubmitBatchResult | null>;
  /** Readable store of the last error, if any. */
  error: Readable<Error | null>;
  /** Readable store of whether a request is in flight. */
  loading: Readable<boolean>;

  /** Estimate the restore cost for the given entries. */
  estimateEntries(entries: EntryKey[]): Promise<EstimateResult>;
  /** Submit a batch restore for the given entries. */
  submitBatch(entries: EntryKey[]): Promise<SubmitBatchResult>;

  /**
   * Watch TTLs for the given entries, polling on an interval and exposing
   * readable stores describing which entries are expiring soon.
   */
  watchTTL(entries: EntryKey[]): SorobanTTLWatcher;

  /** Tear down the store, clearing any active poll timer. */
  destroy(): void;
}

export interface SorobanTTLWatcher {
  /** Entries whose remaining TTL is below the configured threshold. */
  expiringSoon: Readable<EntryKey[]>;
  /** Current watcher status. */
  watchStatus: Readable<WatchStatus>;
  /** Timestamp (ms) of the last completed poll, or null. */
  lastCheckedAt: Readable<number | null>;
  /** Last watcher error, if any. */
  error: Readable<Error | null>;

  /** Start polling. Idempotent: calling while already watching is a no-op. */
  start(): void;
  /** Stop polling. Idempotent: calling while already stopped is a no-op. */
  stop(): void;
  /** Extend the given entries (defaults to the currently expiring ones). */
  extend(entries?: EntryKey[]): Promise<SubmitBatchResult>;
}

export function createSorobanRestoreStore(
  options: SorobanRestoreStoreOptions,
): SorobanRestoreStore {
  const client = new SorobanRestoreClient(options);
  const watchIntervalMs = options.watchIntervalMs ?? 30_000;
  const expiringThreshold = options.expiringThreshold ?? 86_400;

  const estimate = writable<EstimateResult | null>(null);
  const submitBatch = writable<SubmitBatchResult | null>(null);
  const error = writable<Error | null>(null);
  const loading = writable<boolean>(false);

  const timers = new Set<ReturnType<typeof setInterval>>();

  async function estimateEntries(entries: EntryKey[]): Promise<EstimateResult> {
    loading.set(true);
    error.set(null);
    try {
      const result = await client.estimate(entries);
      estimate.set(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      error.set(e);
      throw e;
    } finally {
      loading.set(false);
    }
  }

  async function submitBatchEntries(entries: EntryKey[]): Promise<SubmitBatchResult> {
    loading.set(true);
    error.set(null);
    try {
      const result = await client.submitBatch(entries);
      submitBatch.set(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      error.set(e);
      throw e;
    } finally {
      loading.set(false);
    }
  }

  function watchTTL(entries: EntryKey[]): SorobanTTLWatcher {
    const expiringSoon = writable<EntryKey[]>([]);
    const watchStatus = writable<WatchStatus>('idle');
    const lastCheckedAt = writable<number | null>(null);
    const watchError = writable<Error | null>(null);

    let timer: ReturnType<typeof setInterval> | null = null;
    let running = false;

    async function poll(): Promise<void> {
      try {
        const result = await client.estimate(entries);
        const now = Date.now();
        const expiring = entries.filter((entry) => {
          const remaining = remainingTTL(result, entry);
          return remaining !== null && remaining <= expiringThreshold;
        });
        expiringSoon.set(expiring);
        lastCheckedAt.set(now);
        watchError.set(null);
        watchStatus.set('watching');
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        watchError.set(e);
        watchStatus.set('error');
      }
    }

    function start(): void {
      if (running) return;
      running = true;
      watchStatus.set('watching');
      void poll();
      timer = setInterval(() => {
        void poll();
      }, watchIntervalMs);
      timers.add(timer);
    }

    function stop(): void {
      if (!running) return;
      running = false;
      if (timer !== null) {
        clearInterval(timer);
        timers.delete(timer);
        timer = null;
      }
      watchStatus.set('stopped');
    }

    async function extend(targets?: EntryKey[]): Promise<SubmitBatchResult> {
      const toExtend = targets ?? get(expiringSoon);
      const result = await submitBatchEntries(toExtend);
      await poll();
      return result;
    }

    return {
      expiringSoon: { subscribe: expiringSoon.subscribe },
      watchStatus: { subscribe: watchStatus.subscribe },
      lastCheckedAt: { subscribe: lastCheckedAt.subscribe },
      error: { subscribe: watchError.subscribe },
      start,
      stop,
      extend,
    };
  }

  function destroy(): void {
    for (const timer of timers) {
      clearInterval(timer);
    }
    timers.clear();
  }

  return {
    estimate: { subscribe: estimate.subscribe },
    submitBatch: { subscribe: submitBatch.subscribe },
    error: { subscribe: error.subscribe },
    loading: { subscribe: loading.subscribe },
    estimateEntries,
    submitBatch: submitBatchEntries,
    watchTTL,
    destroy,
  };
}

function remainingTTL(result: EstimateResult, entry: EntryKey): number | null {
  const entries = (result as { entries?: Array<{ key?: EntryKey; remainingTTL?: number; ttl?: number }> }).entries;
  if (!Array.isArray(entries)) return null;
  const match = entries.find((candidate) => sameEntry(candidate.key, entry));
  if (!match) return null;
  if (typeof match.remainingTTL === 'number') return match.remainingTTL;
  if (typeof match.ttl === 'number') return match.ttl;
  return null;
}

function sameEntry(a: EntryKey | undefined, b: EntryKey): boolean {
  if (a === undefined) return false;
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export { readable, derived };
