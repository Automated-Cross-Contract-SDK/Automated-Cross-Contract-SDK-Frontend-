/**
 * Tree-shakeable entry point: the store factory only.
 *
 * Import from `@soroban-resurrect/svelte-hook/store` to pull in
 * `createSorobanResurrect` without any other package surface.
 */
export { createSorobanResurrect } from './createSorobanResurrect.js'

export type { SorobanResurrectStore } from './createSorobanResurrect.js'
