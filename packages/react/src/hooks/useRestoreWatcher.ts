import { useEffect, useRef, useState } from 'react';
import {
  SorobanResurrectClient,
  DEFAULT_EXPIRING_SOON_LEDGERS,
  type SorobanResurrectConfig,
  type RestoreWatcherState,
} from '@soroban-resurrect/sdk';

export interface UseRestoreWatcherOptions extends SorobanResurrectConfig {
  /** Poll interval in milliseconds. Defaults to 30_000. */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

/**
 * React hook that watches the configured contract keys and reports which
 * entries are expiring soon, using the SDK's shared default threshold.
 */
export function useRestoreWatcher(
  options: UseRestoreWatcherOptions = {},
): RestoreWatcherState {
  const {
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    ttlWatchThreshold = DEFAULT_EXPIRING_SOON_LEDGERS,
    ...config
  } = options;

  const [state, setState] = useState<RestoreWatcherState>({
    expiringSoon: [],
    loading: true,
    error: null,
  });

  const clientRef = useRef<SorobanResurrectClient | null>(null);

  useEffect(() => {
    const client = new SorobanResurrectClient({
      ...config,
      ttlWatchThreshold,
    });
    clientRef.current = client;

    let cancelled = false;

    const poll = async () => {
      try {
        const expiringSoon = await client.getExpiringSoonEntries(
          config.keys ?? [],
          ttlWatchThreshold,
        );
        if (!cancelled) {
          setState({ expiringSoon, loading: false, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            expiringSoon: [],
            loading: false,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clientRef.current = null;
    };
  }, [pollIntervalMs, ttlWatchThreshold, JSON.stringify(config)]);

  return state;
}
