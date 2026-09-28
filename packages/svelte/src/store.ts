import { writable, derived, get, type Readable, type Writable } from 'svelte/store';
import {
  SorobanClient,
  type RestoreEstimate,
  type RestoreResult,
  type RestoreBatchResult,
} from '@soroban-kit/core';

export interface SorobanStoreState {
  client: SorobanClient | null;
  connected: boolean;
  network: string | null;
  error: Error | null;
}

export interface WatchTTLOptions {
  /** Poll interval in milliseconds. Defaults to 30_000. */
  intervalMs?: number;
  /** Entries whose remaining TTL is at or below this many ledgers are considered expiring soon. Defaults to 1000. */
  thresholdLedgers?: number;
  /** Automatically start polling when the watcher is created. Defaults to false. */
  autoStart?: boolean;
}

export type WatchStatus = 'idle' | 'watching' | 'stopped' | 'error';

export interface WatchTTLResult {
  expiringSoon: Readable<RestoreEstimate[]>;
  watchStatus: Readable<WatchStatus>;
  lastCheckedAt: Readable<number | null>;
  error: Readable<Error | null>;
  start: () => void;
  stop: () => void;
  extend: () => Promise<RestoreBatchResult | null>;
}

function createSorobanStore() {
  const state: Writable<SorobanStoreState> = writable({
    client: null,
    connected: false,
    network: null,
    error: null,
  });

  const { subscribe, set, update } = state;

  return {
    subscribe,

    connect(client: SorobanClient, network: string) {
      update((s) => ({ ...s, client, connected: true, network, error: null }));
    },

    disconnect() {
      update((s) => ({ ...s, client: null, connected: false, network: null }));
    },

    setError(error: Error | null) {
      update((s) => ({ ...s, error }));
    },

    /**
     * Watch the TTL of the given contract data keys and expose readable stores
     * describing which entries are expiring soon, the current watch status, the
     * timestamp of the last successful check, and any error encountered.
     */
    watchTTL(keys: string[], options: WatchTTLOptions = {}): WatchTTLResult {
      const intervalMs = options.intervalMs ?? 30_000;
      const thresholdLedgers = options.thresholdLedgers ?? 1000;

      const expiringSoon = writable<RestoreEstimate[]>([]);
      const watchStatus = writable<WatchStatus>('idle');
      const lastCheckedAt = writable<number | null>(null);
      const error = writable<Error | null>(null);

      let timer: ReturnType<typeof setInterval> | null = null;
      let running = false;

      const poll = async () => {
        const { client } = get(state);
        if (!client) {
          return;
        }
        try {
          const estimates = await client.estimate(keys);
          const soon = estimates.filter(
            (e) => e.remainingLedgers <= thresholdLedgers,
          );
          expiringSoon.set(soon);
          lastCheckedAt.set(Date.now());
          error.set(null);
        } catch (err) {
          error.set(err instanceof Error ? err : new Error(String(err)));
          watchStatus.set('error');
        }
      };

      const start = () => {
        if (running) {
          return;
        }
        running = true;
        watchStatus.set('watching');
        void poll();
        timer = setInterval(() => {
          void poll();
        }, intervalMs);
      };

      const stop = () => {
        if (!running) {
          return;
        }
        running = false;
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        watchStatus.set('stopped');
      };

      const extend = async (): Promise<RestoreBatchResult | null> => {
        const { client } = get(state);
        if (!client) {
          return null;
        }
        const soon = get(expiringSoon);
        if (soon.length === 0) {
          return null;
        }
        try {
          const result = await client.submitBatch(soon.map((e) => e.key));
          await poll();
          return result;
        } catch (err) {
          error.set(err instanceof Error ? err : new Error(String(err)));
          watchStatus.set('error');
          return null;
        }
      };

      if (options.autoStart) {
        start();
      }

      return {
        expiringSoon: { subscribe: expiringSoon.subscribe },
        watchStatus: { subscribe: watchStatus.subscribe },
        lastCheckedAt: { subscribe: lastCheckedAt.subscribe },
        error: { subscribe: error.subscribe },
        start,
        stop,
        extend,
      };
    },

    destroy() {
      set({ client: null, connected: false, network: null, error: null });
    },
  };
}

export const sorobanStore = createSorobanStore();
export type SorobanStore = ReturnType<typeof createSorobanStore>;
