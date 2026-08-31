/**
 * Tree-shakeable entry point: the context provider and its hooks only.
 *
 * Import from `@soroban-resurrect/react-hook/context` when you use the
 * provider pattern — this excludes the standalone `useSorobanResurrect`
 * implementation.
 */
export {
  SorobanResurrectProvider,
  useSorobanResurrectContext,
  useSorobanResurrectSelector,
} from './SorobanResurrectContext.js'

export type { SorobanResurrectProviderProps } from './SorobanResurrectContext.js'
