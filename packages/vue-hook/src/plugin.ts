import { inject, type App, type InjectionKey } from 'vue'
import { SorobanResurrect, type SorobanResurrectConfig } from '@soroban-resurrect/sdk'

/**
 * Injection key for the shared {@link SorobanResurrect} instance provided by
 * {@link SorobanResurrectPlugin}. Exported for advanced use (e.g. custom
 * `inject` calls or SSR wiring); most consumers should use
 * {@link injectSorobanResurrect} instead.
 */
export const SOROBAN_RESURRECT_KEY: InjectionKey<SorobanResurrect> = Symbol('soroban-resurrect')

/** Options accepted by {@link SorobanResurrectPlugin}. */
export interface SorobanResurrectPluginOptions {
  /** Default SDK configuration used to construct the shared instance. */
  config: SorobanResurrectConfig
}

/**
 * Vue plugin that constructs a single shared {@link SorobanResurrect} instance
 * and provides it to the whole app, so components can consume it with
 * {@link injectSorobanResurrect} without any manual `provide`/`inject` wiring.
 *
 * The standalone `useSorobanResurrect` composable is unaffected — use it when a
 * component needs its own instance or a reactive config.
 *
 * @example
 * ```ts
 * import { createApp } from 'vue'
 * import { SorobanResurrectPlugin } from '@soroban-resurrect/vue-hook'
 * import App from './App.vue'
 *
 * createApp(App).use(SorobanResurrectPlugin, {
 *   config: { rpcUrl: 'https://soroban-testnet.stellar.org' },
 * }).mount('#app')
 * ```
 *
 * ```ts
 * // Any component, anywhere in the tree:
 * import { injectSorobanResurrect } from '@soroban-resurrect/vue-hook'
 *
 * const resurrect = injectSorobanResurrect()
 * await resurrect.submitWithRestore({ transaction, wallet })
 * ```
 */
export const SorobanResurrectPlugin = {
  install(app: App, options: SorobanResurrectPluginOptions) {
    if (!options?.config) {
      throw new Error(
        'SorobanResurrectPlugin: `config` is required, e.g. app.use(SorobanResurrectPlugin, { config: { rpcUrl } })',
      )
    }
    const instance = new SorobanResurrect(options.config)
    app.provide(SOROBAN_RESURRECT_KEY, instance)
  },
}

/**
 * Consumes the shared {@link SorobanResurrect} instance provided by
 * {@link SorobanResurrectPlugin}. Must be called from within `setup()`.
 *
 * @throws If the plugin was not installed via `app.use(SorobanResurrectPlugin, ...)`.
 */
export function injectSorobanResurrect(): SorobanResurrect {
  const instance = inject(SOROBAN_RESURRECT_KEY)
  if (!instance) {
    throw new Error(
      'injectSorobanResurrect(): no instance found. Did you call app.use(SorobanResurrectPlugin, { config })?',
    )
  }
  return instance
}
