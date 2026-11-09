import type { SorobanResurrect } from '@soroban-resurrect/sdk'
import { useOptionalSorobanResurrectContext } from '../SorobanResurrectContext.js'

export interface UseResolvedResurrectOptions {
  /**
   * A `SorobanResurrect` instance to use when no provider is present.
   * When omitted, the hook falls back to the nearest
   * `SorobanResurrectProvider`.
   */
  resurrect?: SorobanResurrect
}

/**
 * Resolves the active `SorobanResurrect` instance, preferring an explicitly
 * supplied instance and otherwise falling back to the provider context.
 */
export function useResolvedResurrect(options: UseResolvedResurrectOptions = {}): SorobanResurrect {
  const context = useOptionalSorobanResurrectContext()
  const resolved = options.resurrect ?? context?.resurrect ?? null
  if (!resolved) {
    throw new Error(
      'useResolvedResurrect: no SorobanResurrect instance found. ' +
        'Pass one via options.resurrect or wrap your tree in a SorobanResurrectProvider.',
    )
  }
  return resolved
}
