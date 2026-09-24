/**
 * Type-level public API surface test for `@soroban-resurrect/svelte-hook`.
 *
 * Pins the `createSorobanResurrect` factory return value and the public
 * store/estimate/batch types.
 *
 * Run with: `npm run test:types -w packages/svelte-hook`
 */
import { expectTypeOf, test } from 'vitest'
import * as svelteHook from './index.js'
import type {
  SorobanResurrectStore,
  FeeEstimate,
  BatchItemState,
  BatchSubmission,
} from './index.js'
import type { Readable } from 'svelte/store'
import type { RestoreStateInfo, ResurrectResult, ArchivedLedgerEntry } from '@soroban-resurrect/sdk'

type PublicExports = 'createSorobanResurrect'

test('all documented public exports are present', () => {
  expectTypeOf<PublicExports>().toMatchTypeOf<keyof typeof svelteHook>()
})

test('SorobanResurrectStore return shape', () => {
  expectTypeOf<SorobanResurrectStore['state']>().toEqualTypeOf<Readable<RestoreStateInfo>>()
  expectTypeOf<SorobanResurrectStore['isProcessing']>().toEqualTypeOf<Readable<boolean>>()
  expectTypeOf<SorobanResurrectStore['archivedKeys']>().toEqualTypeOf<
    Readable<ArchivedLedgerEntry[]>
  >()
  expectTypeOf<SorobanResurrectStore['lastResult']>().toEqualTypeOf<
    Readable<ResurrectResult | null>
  >()
  expectTypeOf<SorobanResurrectStore['feeEstimate']>().toEqualTypeOf<Readable<FeeEstimate | null>>()
  expectTypeOf<SorobanResurrectStore['submitWithRestore']>().returns.toEqualTypeOf<
    Promise<ResurrectResult>
  >()
  expectTypeOf<SorobanResurrectStore['destroy']>().returns.toEqualTypeOf<void>()
})

test('batch submission types are pinned', () => {
  expectTypeOf<BatchItemState['status']>().toEqualTypeOf<
    'pending' | 'submitting' | 'success' | 'error'
  >()
  expectTypeOf<BatchSubmission['items']>().toEqualTypeOf<Readable<BatchItemState>[]>()
  expectTypeOf<BatchSubmission['done']>().toEqualTypeOf<Promise<ResurrectResult[]>>()
})

test('fee estimate type is pinned', () => {
  expectTypeOf<FeeEstimate['multiplier']>().toEqualTypeOf<number>()
  expectTypeOf<FeeEstimate['estimatedRestoreFee']>().toEqualTypeOf<string>()
})
