import {
  shallowRef,
  watch,
  onScopeDispose,
  toValue,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue'
import { SorobanResurrect, type SorobanResurrectConfig } from '@soroban-resurrect/sdk'

/** Ways to supply a `SorobanResurrect` instance to a composable. */
export interface ResolveResurrectOptions {
  /**
   * An existing SDK instance (e.g. from `useSorobanResurrect().resurrect`).
   * This composable does not own or dispose this instance.
   */
  resurrect?: MaybeRefOrGetter<SorobanResurrect | null | undefined>
  /**
   * Config for a standalone instance owned by the composable. Used only when
   * `resurrect` is not provided. Changing it disposes and re-creates the instance.
   */
  config?: MaybeRefOrGetter<SorobanResurrectConfig | null | undefined>
}

/**
 * Resolves a reactive `SorobanResurrect` instance from either an explicit
 * `resurrect` ref/getter or a `config` ref/getter. Instances created from
 * config are owned and disposed when the config or active scope changes.
 * Throws at call time if neither is given.
 */
export function resolveResurrect(
  options: ResolveResurrectOptions,
): ShallowRef<SorobanResurrect | undefined> {
  if (!options.resurrect && !options.config) {
    throw new Error(
      'resolveResurrect: pass either `resurrect` (an instance) or `config` in the options.',
    )
  }

  const out = shallowRef<SorobanResurrect | undefined>(undefined)
  let owned: SorobanResurrect | null = null

  watch(
    () => {
      const explicit = options.resurrect ? toValue(options.resurrect) : null
      if (explicit) return { explicit }
      const cfg = options.config ? toValue(options.config) : null
      return { cfg }
    },
    (resolved) => {
      owned?.dispose()
      owned = null
      if ('explicit' in resolved && resolved.explicit) {
        out.value = resolved.explicit
      } else if ('cfg' in resolved && resolved.cfg) {
        owned = new SorobanResurrect(resolved.cfg)
        out.value = owned
      } else {
        out.value = undefined
      }
    },
    { immediate: true, deep: true },
  )

  onScopeDispose(() => {
    owned?.dispose()
    owned = null
    out.value = undefined
  })

  return out
}
