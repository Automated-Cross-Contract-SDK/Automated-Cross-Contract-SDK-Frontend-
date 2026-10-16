import type { SdkRuntime } from './types.js'

/** Runtime primitives backed by the host's standard JavaScript globals. */
export const SYSTEM_RUNTIME: SdkRuntime = {
  now: () => Date.now(),
  random: () => Math.random(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer),
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (timer) => globalThis.clearInterval(timer),
}
