import React, { createContext, useContext, useMemo, useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  RestoreState,
  RestoreResult,
  RestoreOptions,
  SorobanResurrectClient,
} from '@soroban-resurrect/core';
import { isIdleState, isSuccessState, isErrorState } from '@soroban-resurrect/core';

export interface SorobanResurrectContextValue {
  state: RestoreState;
  isProcessing: boolean;
  isIdle: boolean;
  isSuccess: boolean;
  isError: boolean;
  lastResult: RestoreResult | null;
  resurrect: (options?: RestoreOptions) => Promise<RestoreResult>;
  on: (event: string, handler: (...args: unknown[]) => void) => () => void;
}

const SorobanResurrectContext = createContext<SorobanResurrectContextValue | null>(null);

export interface SorobanResurrectProviderProps {
  client: SorobanResurrectClient;
  children: ReactNode;
}

export function SorobanResurrectProvider({
  client,
  children,
}: SorobanResurrectProviderProps) {
  const [state, setState] = useState<RestoreState>({ state: 'idle' });
  const [lastResult, setLastResult] = useState<RestoreResult | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const resurrect = useCallback(
    async (options?: RestoreOptions): Promise<RestoreResult> => {
      const result = await client.resurrect(options);
      setLastResult(result);
      return result;
    },
    [client],
  );

  const on = useCallback(
    (event: string, handler: (...args: unknown[]) => void) => {
      return client.on(event, handler);
    },
    [client],
  );

  const value = useMemo<SorobanResurrectContextValue>(() => {
    return {
      state,
      isProcessing: state.state === 'processing',
      isIdle: isIdleState(state),
      isSuccess: isSuccessState(state),
      isError: isErrorState(state),
      lastResult,
      resurrect,
      on,
    };
  }, [state, lastResult, resurrect, on]);

  return (
    <SorobanResurrectContext.Provider value={value}>
      {children}
    </SorobanResurrectContext.Provider>
  );
}

export function useSorobanResurrectContext(): SorobanResurrectContextValue {
  const context = useContext(SorobanResurrectContext);
  if (!context) {
    throw new Error(
      'useSorobanResurrectContext must be used within a SorobanResurrectProvider',
    );
  }
  return context;
}
