import { useMemo } from 'react';
import type { SorobanResurrect } from '@soroban-resurrect/core';
import { useSorobanResurrectContext } from '../context/SorobanResurrectContext';
import type { RestoreCostEstimate } from '@soroban-resurrect/core';

export interface UseResolvedResurrectOptions {
  /**
   * A `SorobanResurrect` instance to use when no provider is present.
   * When omitted, the hook falls back to the nearest
   * `SorobanResurrectProvider`.
   */
  resurrect?: SorobanResurrect;
}

/**
 * Resolves the active `SorobanResurrect` instance, preferring an explicitly
 * supplied instance and otherwise falling back to the provider context.
 */
export function useResolvedResurrect(
  options: UseResolvedResurrectOptions = {},
): SorobanResurrect {
  const context = useSorobanResurrectContext();
  const { resurrect } = options;

  return useMemo(() => {
    const resolved = resurrect ?? context;
    if (!resolved) {
      throw new Error(
        'useResolvedResurrect: no SorobanResurrect instance found. ' +
          'Pass one via options.resurrect or wrap your tree in a SorobanResurrectProvider.',
      );
    }
    return resolved;
  }, [resurrect, context]);
}

export interface UseRestoreEstimateOptions extends UseResolvedResurrectOptions {}

export interface UseRestoreEstimateResult {
  /**
   * Estimate the restore cost for a transaction. Resolves a
   * `RestoreCostEstimate` and tracks loading/error state.
   */
  estimateFor: (tx: unknown) => Promise<RestoreCostEstimate>;
  /** The most recent successful estimate, if any. */
  estimate: RestoreCostEstimate | null;
  /** True only while an estimate call is in flight. */
  isEstimating: boolean;
  /** The most recent error message, if any. */
  error: string | null;
  /** Clears the current estimate and error. */
  reset: () => void;
}

/**
 * React hook that estimates the cost of restoring a transaction, backed by
 * `estimateRestoreCost`. Works standalone (via `options.resurrect`) or inside
 * a `SorobanResurrectProvider`.
 */
export function useRestoreEstimate(
  options: UseRestoreEstimateOptions = {},
): UseRestoreEstimateResult {
  const resurrect = useResolvedResurrect(options);
  const [estimate, setEstimate] = useState<RestoreCostEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const estimateFor = useCallback(
    async (tx: unknown): Promise<RestoreCostEstimate> => {
      const requestId = ++requestIdRef.current;
      setIsEstimating(true);
      setError(null);
      try {
        const result = await resurrect.estimateRestoreCost(tx as never);
        if (requestId === requestIdRef.current) {
          setEstimate(result);
        }
        return result;
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
        throw err;
      } finally {
        if (requestId === requestIdRef.current) {
          setIsEstimating(false);
        }
      }
    },
    [resurrect],
  );

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setEstimate(null);
    setError(null);
    setIsEstimating(false);
  }, []);

  return { estimateFor, estimate, isEstimating, error, reset };
}
