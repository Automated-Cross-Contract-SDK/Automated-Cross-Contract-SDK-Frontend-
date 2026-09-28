import { useEffect, useMemo, useRef, useState } from 'react';
import { SorobanResurrect } from '../SorobanResurrect';
import type { SorobanResurrectConfig, ResurrectResult } from '../types';

/**
 * Derive a stable key from the primitive fields of the config so we can detect
 * meaningful changes without serializing the whole object (which throws on
 * configs that hold an `rpcClient` or `logger`).
 */
function getConfigKey(config: SorobanResurrectConfig): string {
  return [
    config.rpcUrl ?? '',
    config.network ?? '',
    config.contractId ?? '',
    config.networkPassphrase ?? '',
  ].join('|');
}

export interface UseSorobanResurrectResult {
  resurrect: SorobanResurrect | null;
  result: ResurrectResult | null;
  loading: boolean;
  error: Error | null;
}

/**
 * React hook that lazily creates a {@link SorobanResurrect} instance and keeps
 * it in sync with the provided config.
 *
 * The instance is created inside an effect (never during render) so that
 * StrictMode double-renders and concurrent rendering do not leak instances or
 * their subscriptions. When the primitive config key changes the previous
 * instance is torn down before a new one is created.
 */
export function useSorobanResurrect(
  config: SorobanResurrectConfig,
): UseSorobanResurrectResult {
  const configKey = useMemo(() => getConfigKey(config), [
    config.rpcUrl,
    config.network,
    config.contractId,
    config.networkPassphrase,
  ]);

  const configRef = useRef(config);
  configRef.current = config;

  const [resurrect, setResurrect] = useState<SorobanResurrect | null>(null);
  const [result, setResult] = useState<ResurrectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const instance = new SorobanResurrect(configRef.current);
    setResurrect(instance);
    setResult(null);
    setError(null);

    return () => {
      // Tear down the previous instance so its watchers/listeners are removed
      // before a replacement is created (or the hook unmounts).
      instance.stop?.();
      instance.removeAllListeners?.();
    };
  }, [configKey]);

  return { resurrect, result, loading, error };
}
