/**
 * Type-level public API surface test for `@soroban-resurrect/vue-hook`.
 *
 * Pins the exported composables/plugin and the reactive shape of the
 * `useSorobanResurrect` return value.
 *
 * Run with: `npm run test:types -w packages/vue-hook`
 */
import { expectTypeOf, test } from 'vitest'
import * as hook from './index.js'
import type { UseSorobanResurrectReturn, SorobanResurrectPluginOptions } from './index.js'
import type { SorobanResurrect, ResurrectResult, ArchivedLedgerEntry } from '@soroban-resurrect/sdk'

type PublicExports =
  | 'useSorobanResurrect'
  | 'useSorobanResurrectEstimate'
  | 'useSorobanResurrectWatcher'
  | 'SorobanResurrectPlugin'
  | 'injectSorobanResurrect'
  | 'SOROBAN_RESURRECT_KEY'

test('all documented public exports are present', () => {
  expectTypeOf<PublicExports>().toMatchTypeOf<keyof typeof hook>()
})

test('useSorobanResurrect return shape', () => {
  expectTypeOf<UseSorobanResurrectReturn['state']>().toHaveProperty('value')
  expectTypeOf<UseSorobanResurrectReturn['state']>().not.toBeAny()
  expectTypeOf<UseSorobanResurrectReturn['isProcessing']>().toHaveProperty('value')
  expectTypeOf<UseSorobanResurrectReturn['isProcessing']['value']>().toEqualTypeOf<boolean>()
  expectTypeOf<UseSorobanResurrectReturn['isIdle']['value']>().toEqualTypeOf<boolean>()
  expectTypeOf<UseSorobanResurrectReturn['isSuccess']['value']>().toEqualTypeOf<boolean>()
  expectTypeOf<UseSorobanResurrectReturn['isError']['value']>().toEqualTypeOf<boolean>()
  expectTypeOf<UseSorobanResurrectReturn['submitWithRestore']>().returns.toEqualTypeOf<
    Promise<ResurrectResult>
  >()
  expectTypeOf<UseSorobanResurrectReturn['detectArchivedKeys']>().returns.toEqualTypeOf<
    Promise<ArchivedLedgerEntry[]>
  >()
  expectTypeOf<UseSorobanResurrectReturn['resurrect']>().toHaveProperty('value')
  expectTypeOf<
    UseSorobanResurrectReturn['resurrect']['value']
  >().toEqualTypeOf<SorobanResurrect | null>()
  expectTypeOf<UseSorobanResurrectReturn['reset']>().returns.toEqualTypeOf<void>()
})

test('plugin options are pinned', () => {
  expectTypeOf<SorobanResurrectPluginOptions>().toHaveProperty('config')
})
