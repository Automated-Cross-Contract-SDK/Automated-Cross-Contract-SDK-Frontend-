import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SorobanResurrect } from '../SorobanResurrect';
import type { SorobanResurrectConfig } from '../types';

interface SorobanResurrectContextValue {
  resurrect: SorobanResurrect | null;
  configKey: string;
}

const SorobanResurrectContext = createContext<SorobanResurrectContextValue>({
  resurrect: null,
  configKey: '',
});

/**
 * Build a stable key from the primitive fields of the config so we can detect
 * meaningful changes without serializing the whole object (which throws on
 * configs that hold an `rpcClient` or `logger`).
 */
function getConfigKey(config: SorobanResurrectConfig): string {
  return [
    config.rpcUrl ?? '',
    config.network ?? '',
    config.contractId ?? '',
    config.pollInterval ?? '',
  ].join('|');
}

export interface SorobanResurrectProviderProps {
  config: SorobanResurrectConfig;
  children?: React.ReactNode;
}

export function SorobanResurrectProvider({
  config,
  children,
}: SorobanResurrectProviderProps) {
  const configKey = useMemo(() => getConfigKey(config), [
    config.rpcUrl,
    config.network,
    config.contractId,
    config.pollInterval,
  ]);

  // Keep the latest config in a ref so the instance can be (re)created lazily
  // in an effect without re-running on every render.
  const configRef = useRef(config);
  configRef.current = config;

  const [resurrect, setResurrect] = useState<SorobanResurrect | null>(null);

  useEffect(() => {
    const instance = new SorobanResurrect(configRef.current);
    setResurrect(instance);

    return () => {
      // Tear down the previous instance so watchers/listeners are removed.
      instance.stop?.();
      instance.removeAllListeners?.();
    };
  }, [configKey]);

  const value = useMemo<SorobanResurrectContextValue>(
    () => ({ resurrect, configKey }),
    [resurrect, configKey],
  );

  return (
    <SorobanResurrectContext.Provider value={value}>
      {children}
    </SorobanResurrectContext.Provider>
  );
}

export function useSorobanResurrect(): SorobanResurrect | null {
  return useContext(SorobanResurrectContext).resurrect;
}

export function useSorobanResurrectConfigKey(): string {
  return useContext(SorobanResurrectContext).configKey;
}
