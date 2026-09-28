import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import {
  SorobanResurrectConfig,
  SorobanResurrectResult,
  DEFAULT_EXPIRING_SOON_LEDGERS,
} from '@soroban-resurrect/sdk';

/**
 * Vue composable that watches a set of contract data keys and reports which
 * entries are expiring soon based on the configured TTL watch threshold.
 *
 * The "expiring soon" window defaults to the SDK-wide
 * `DEFAULT_EXPIRING_SOON_LEDGERS` (~24h) and can be overridden through
 * `SorobanResurrectConfig.ttlWatchThreshold`.
 */
export function useSorobanResurrectWatcher(
  config: SorobanResurrectConfig
): SorobanResurrectResult {
  const ttlWatchThreshold =
    config.ttlWatchThreshold ?? DEFAULT_EXPIRING_SOON_LEDGERS;

  const expiringSoon = ref<string[]>([]);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function check(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const entries = await config.client.getExpiringSoonEntries(
        config.keys,
        ttlWatchThreshold
      );
      expiringSoon.value = entries;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    void check();
    if (config.pollInterval && config.pollInterval > 0) {
      intervalId = setInterval(() => {
        void check();
      }, config.pollInterval);
    }
  });

  onUnmounted(() => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });

  return {
    expiringSoon: expiringSoon as Ref<string[]>,
    loading: loading as Ref<boolean>,
    error: error as Ref<Error | null>,
    refresh: check,
  };
}
