import { shallowRef, watch, onUnmounted, toValue, type MaybeRefOrGetter, type ShallowRef } from 'vue'
import { SorobanResurrect, type SorobanResurrectConfig } from '@soroban-resurrect/sdk'

/** Ways to supply a `SorobanResurrect` instance to a composable. */
export interface ResolveResurrectOptions {
  /** An existing SDK instance (e.g. from `useSorobanResurrect().resurrect`). */
  resurrect?: MaybeRefOrGetter<SorobanResurrect | null | undefined>
  /**
   * Config for a standalone instance owned by the composable. Used only when
   * `resurrect` is not provided. Changing it re-creates the instance.
   */
  config?: MaybeRefOrGetter<SorobanResurrectConfig | null | undefined>
}

/**
 * Resolves a reactive `SorobanResurrect` instance from either an explicit
 * `resurrect` ref/getter or a `config` ref/getter (SSR-safe: only constructs
 * lazily, cleans up on unmount). Throws at call time if neither is given.
 */
export function resolveResurrect(options: ResolveResurrectOptions): ShallowRef<SorobanResurrect> {
  if (!options.resurrect && !options.config) {
    throw new Error(
      'resolveResurrect: pass either `resurrect` (an instance) or `config` in the options.',
    )
  }

  const out = shallowRef<SorobanResurrect>()

  watch(
    () => {
      const explicit = options.resurrect ? toValue(options.resurrect) : null
      if (explicit) return { explicit }
      const cfg = options.config ? toValue(options.config) : null
      return { cfg }
    },
    (resolved) => {
      if ('explicit' in resolved && resolved.explicit) {
        out.value = resolved.explicit
      } else if ('cfg' in resolved && resolved.cfg) {
        out.value = new SorobanResurrect(resolved.cfg)
      }
    },
    { immediate: true, deep: true },
  )

  onUnmounted(() => {
    out.value = undefined
  })

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return out as ShallowRef<SorobanResurrect>
}
