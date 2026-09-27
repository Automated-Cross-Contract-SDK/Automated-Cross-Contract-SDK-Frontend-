export {
  SorobanResurrectProvider,
  useSorobanResurrectContext,
  useOptionalSorobanResurrectContext,
  SorobanResurrectContext,
} from './SorobanResurrectContext.js'

export { useSorobanResurrect } from './useSorobanResurrect.js'

export { useSorobanResurrectSubmit } from './useSorobanResurrectSubmit.js'

export { useRestoreWatcher } from './useRestoreWatcher.js'

export { useSorobanResurrectNetwork } from './useSorobanResurrectNetwork.js'

export type { SorobanResurrectProviderProps } from './SorobanResurrectContext.js'

export type {
  UseSorobanResurrectOptions,
  UseSorobanResurrectReturn,
} from './useSorobanResurrect.js'

export type { ResolvedResurrectOptions } from './useResolvedResurrect.js'

export type {
  UseSorobanResurrectSubmitOptions,
  UseSorobanResurrectSubmitReturn,
} from './useSorobanResurrectSubmit.js'

export type {
  UseRestoreWatcherOptions,
  UseRestoreWatcherReturn,
  RestoreWatchStatus,
} from './useRestoreWatcher.js'

export type {
  UseSorobanResurrectNetworkOptions,
  UseSorobanResurrectNetworkReturn,
  NetworkPresetEntry,
} from './useSorobanResurrectNetwork.js'

/**
 * React Native / Metro entry point.
 *
 * This module is the `react-native` export condition for
 * `@soroban-resurrect/react-hook`. It re-exports the same public API as the
 * browser build but is safe to import in a Metro bundle: no browser-only
 * global (`window`, `document`, `localStorage`) is touched at import time.
 *
 * Polyfill requirements (see the package README for details):
 *
 * - `crypto.randomUUID` — required by history persistence and idempotency
 *   keys. React Native's Hermes runtime does not ship it; install
 *   `react-native-get-random-values` (or `expo-crypto`) and import it once at
 *   the top of your app entry before importing this package.
 * - `fetch` — required when `useSSE: true` is used. React Native provides a
 *   global `fetch`, but streaming `Response.body` is not available; use the
 *   polling watcher (`useRestoreWatcher`) or a streaming-capable polyfill
 *   such as `react-native-fetch-api` + `web-streams-polyfill`.
 * - `AsyncStorage` — required for history persistence. Pass a storage adapter
 *   (e.g. `@react-native-async-storage/async-storage`) via the provider's
 *   `storage` option; the browser `localStorage` default is never accessed on
 *   this entry.
 * - Timers — `useRestoreWatcher` uses `setTimeout`/`clearTimeout`, which are
 *   available in React Native and are torn down on unmount.
 */
export * from './index.js'
