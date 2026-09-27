import { useCallback, useRef, useState } from 'react';
import type { RestoreCostEstimate } from '@soroban-resurrect/core';
import { useResolvedResurrect } from './useResolvedResurrect';

export interface UseRestoreEstimateOptions {
  /**
   * Optional callback invoked whenever an estimate resolves successfully.
   */
  onSuccess?: (estimate: RestoreCostEstimate) => void;
  /**
   * Optional callback invoked whenever an estimate fails.
   */
  onError?: (error: string) => void;
}

export interface UseRestoreEstimateResult {
  /**
   * Estimate the restore cost for a transaction. Resolves with the
   * `RestoreCostEstimate` produced by `estimateRestoreCost`.
   */
  estimateFor: (tx: unknown) => Promise<RestoreCostEstimate>;
  /**
   * The most recent successful estimate. Survives failed calls.
   */
  estimate: RestoreCostEstimate | null;
  /**
   * True only while a call is in flight.
   */
  isEstimating: boolean;
  /**
   * The most recent error message, or null when there is none.
   */
  error: string | null;
  /**
   * Clear the current estimate and error state.
   */
  reset: () => void;
}

/**
 * React hook that estimates the cost of restoring a Soroban transaction.
 *
 * Works standalone or inside a `SorobanResurrectProvider` by resolving the
 * resurrect instance through `useResolvedResurrect`.
 */
export function useRestoreEstimate(
  options: UseRestoreEstimateOptions = {},
): UseRestoreEstimateResult {
  const resurrect = useResolvedResurrect();
  const [estimate, setEstimate] = useState<RestoreCostEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the latest in-flight call so concurrent calls do not leak state.
  const callIdRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const estimateFor = useCallback(
    async (tx: unknown): Promise<RestoreCostEstimate> => {
      const callId = ++callIdRef.current;
      setIsEstimating(true);
      setError(null);

      try {
        const result = await resurrect.estimateRestoreCost(tx as never);
        if (callId === callIdRef.current) {
          setEstimate(result);
          setIsEstimating(false);
        }
        optionsRef.current.onSuccess?.(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (callId === callIdRef.current) {
          setError(message);
          setIsEstimating(false);
        }
        optionsRef.current.onError?.(message);
        throw err;
      }
    },
    [resurrect],
  );

  const reset = useCallback(() => {
    callIdRef.current += 1;
    setEstimate(null);
    setError(null);
    setIsEstimating(false);
  }, []);

  return { estimateFor, estimate, isEstimating, error, reset };
}
