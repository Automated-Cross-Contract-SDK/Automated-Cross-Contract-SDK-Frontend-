import { useEffect, useMemo, useRef, useState } from 'react';
import { SorobanResurrect } from '../index';
import type { SorobanResurrectConfig, ResurrectResult } from '../index';

/**
 * Derive a stable key from the primitive fields of the config so we can detect
 * meaningful changes without serializing the whole object (which throws on
 * configs holding an `rpcClient` or `logger`).
 */
function configKey(config: SorobanResurrectConfig): string {
  return [
    config.rpcUrl ?? '',
    config.network ?? '',
    config.contractId ?? '',
    config.networkPassphrase ?? '',
  ].join('|');
}

/**
 * Lazily create the SDK instance in an effect so no instance is created during
 * render (StrictMode double-render / concurrent rendering safe). The previous
 * instance is torn down whenever the config key changes.
 */
function useSorobanResurrectInstance(config: SorobanResurrectConfig) {
  const key = configKey(config);
  const configRef = useRef(config);
  configRef.current = config;

  const [instance, setInstance] = useState<SorobanResurrect | null>(null);

  useEffect(() => {
    const next = new SorobanResurrect(configRef.current);
    setInstance(next);
    return () => {
      next.destroy?.();
    };
  }, [key]);

  return instance;
}

export function useSorobanResurrect(config: SorobanResurrectConfig) {
  const instance = useSorobanResurrectInstance(config);
  const [result, setResult] = useState<ResurrectResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!instance) return;
    let active = true;
    setResult(null);
    setError(null);
    setLoading(true);
    instance
      .resurrect()
      .then((res) => {
        if (active) setResult(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [instance]);

  return { result, error, loading, instance };
}

export function SorobanResurrectProvider({
  config,
  children,
}: {
  config: SorobanResurrectConfig;
  children: React.ReactNode;
}) {
  const instance = useSorobanResurrectInstance(config);
  const value = useMemo(() => ({ instance }), [instance]);
  return <SorobanResurrectContext.Provider value={value}>{children}</SorobanResurrectContext.Provider>;
}

export const SorobanResurrectContext = React.createContext<{
  instance: SorobanResurrect | null;
}>({ instance: null });
