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
 * caller having to branch. Throws if none of the three sources yields an
 * instance.
 */
export function useResolvedResurrect(options: ResolvedResurrectOptions): SorobanResurrect {
  const { resurrect: explicit, config } = options
  const ctx = useOptionalSorobanResurrectContext()

  const ownRef = useRef<SorobanResurrect | null>(null)
  const prevConfigRef = useRef<string | null>(null)
  const [, forceRender] = useState(0)

  const configKey = config ? JSON.stringify(config) : null

  if (!explicit && !ctx?.resurrect && config) {
    if (!ownRef.current || prevConfigRef.current !== configKey) {
      prevConfigRef.current = configKey
      ownRef.current = new SorobanResurrect(config)
    }
  }

  // Re-render when the standalone instance is (re)created via config change.
  useEffect(() => {
    if (!explicit && !ctx?.resurrect && config) {
      forceRender((n) => n + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey])

  const instance = explicit ?? ctx?.resurrect ?? ownRef.current

  if (!instance) {
    throw new Error(
      'useResolvedResurrect: no SorobanResurrect instance available. Pass ' +
        '`resurrect` or `config`, or render inside a <SorobanResurrectProvider>.',
    )
  }

  return instance
}
