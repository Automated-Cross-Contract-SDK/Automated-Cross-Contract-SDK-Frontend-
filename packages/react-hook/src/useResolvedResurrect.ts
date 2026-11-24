import { useEffect, useRef, useState } from 'react'
import { SorobanResurrect, type SorobanResurrectConfig } from '@soroban-resurrect/sdk'
import { useOptionalSorobanResurrectContext } from './SorobanResurrectContext.js'

/** Common options for hooks that need a `SorobanResurrect` instance. */
export interface ResolvedResurrectOptions {
  /**
   * Explicit SDK instance to use. Takes precedence over everything else.
   * Handy when the caller already owns an instance (e.g. from
   * `useSorobanResurrect`).
   */
  resurrect?: SorobanResurrect
  /**
   * Config for a standalone instance, created and owned by the hook. Used
   * only when neither `resurrect` nor a surrounding
   * `<SorobanResurrectProvider>` is available. Changing the config
   * re-creates the instance.
   */
  config?: SorobanResurrectConfig
}

/**
 * Resolves a `SorobanResurrect` instance from (in priority order):
 * an explicit `options.resurrect`, the nearest `<SorobanResurrectProvider>`,
 * or a standalone instance built from `options.config`.
 *
 * This lets a hook "work both under Provider and standalone" without the
 * caller having to branch. Throws if none of the three sources is present.
 *
 * Returns `null` only while a surrounding provider has not created its
 * instance yet: the provider constructs it in an effect (so server rendering
 * never builds an RPC client), which runs after its children's first render.
 */
export function useResolvedResurrect(options: ResolvedResurrectOptions): SorobanResurrect | null {
  const { resurrect: explicit, config } = options
  const ctx = useOptionalSorobanResurrectContext()

  const ownRef = useRef<SorobanResurrect | null>(null)
  const prevConfigRef = useRef<string | null>(null)
  const [, forceRender] = useState(0)

  const configKey = config ? JSON.stringify(config) : null

  if (!explicit && !ctx && config) {
    if (!ownRef.current || prevConfigRef.current !== configKey) {
      prevConfigRef.current = configKey
      ownRef.current = new SorobanResurrect(config)
    }
  }

  // Re-render when the standalone instance is (re)created via config change.
  useEffect(() => {
    if (!explicit && !ctx && config) {
      forceRender((n) => n + 1)
    }
  }, [configKey])

  const instance = explicit ?? (ctx ? ctx.resurrect : ownRef.current)

  if (!instance && !ctx) {
    throw new Error(
      'useResolvedResurrect: no SorobanResurrect instance available. Pass ' +
        '`resurrect` or `config`, or render inside a <SorobanResurrectProvider>.',
    )
  }

  return instance
}
