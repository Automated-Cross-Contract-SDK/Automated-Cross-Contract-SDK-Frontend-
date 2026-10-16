/**
 * Type-level public API surface test for `@soroban-resurrect/adapter-freighter`.
 *
 * The compiler enforces `implements WalletAdapter`, but that guarantee is lost
 * the moment the class shape drifts in a rename/refactor. These assertions pin
 * the adapter to the SDK contract explicitly.
 *
 * Run with: `npm run test:types -w packages/adapter-freighter`
 */
import { expectTypeOf, test } from 'vitest'
import { FreighterAdapter } from './index.js'
import type { FreighterSignOptions } from './index.js'
import type { WalletAdapter, WalletCapabilities } from '@soroban-resurrect/sdk'

test('FreighterAdapter satisfies the SDK WalletAdapter contract', () => {
  expectTypeOf<FreighterAdapter>().toMatchTypeOf<WalletAdapter>()
  expectTypeOf<FreighterAdapter['isConnected']>().returns.toEqualTypeOf<Promise<boolean>>()
  expectTypeOf<FreighterAdapter['getPublicKey']>().returns.toMatchTypeOf<Promise<unknown>>()
  expectTypeOf<FreighterAdapter['signTransaction']>().toBeFunction()
  expectTypeOf<FreighterAdapter['getNetwork']>().returns.toEqualTypeOf<Promise<string>>()
})

test('FreighterAdapter advertises wallet capabilities', () => {
  expectTypeOf<FreighterAdapter['capabilities']>().toEqualTypeOf<WalletCapabilities>()
})

test('Freighter signing options document the supported network selectors', () => {
  expectTypeOf<FreighterSignOptions>().toHaveProperty('networkPassphrase')
  expectTypeOf<FreighterSignOptions>().toHaveProperty('network')
})
