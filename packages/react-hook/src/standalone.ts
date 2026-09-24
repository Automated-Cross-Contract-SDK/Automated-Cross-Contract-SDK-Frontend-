/**
 * Tree-shakeable entry point: the standalone hook only.
 *
 * Import from `@soroban-resurrect/react-hook/standalone` when you do not use
 * the context provider — this pulls in `useSorobanResurrect` without the
 * provider/context/selector code.
 */
export { useSorobanResurrect } from './useSorobanResurrect.js'

export type {
  UseSorobanResurrectOptions,
  UseSorobanResurrectReturn,
} from './useSorobanResurrect.js'
