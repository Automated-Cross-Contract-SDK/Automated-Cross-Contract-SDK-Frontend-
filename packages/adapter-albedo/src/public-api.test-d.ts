/**
 * Type-level public API surface test for `@soroban-resurrect/adapter-albedo`.
 *
 * Run with: `npm run test:types -w packages/adapter-albedo`
 */
import { expectTypeOf, test } from 'vitest'
import { AlbedoAdapter } from './index.js'
import type { WalletAdapter, WalletCapabilities } from '@soroban-resurrect/sdk'

test('AlbedoAdapter satisfies the SDK WalletAdapter contract', () => {
  expectTypeOf<AlbedoAdapter>().toMatchTypeOf<WalletAdapter>()
  expectTypeOf<AlbedoAdapter['isConnected']>().returns.toEqualTypeOf<Promise<boolean>>()
  expectTypeOf<AlbedoAdapter['getPublicKey']>().returns.toMatchTypeOf<Promise<unknown>>()
  expectTypeOf<AlbedoAdapter['signTransaction']>().toBeFunction()
})

test('AlbedoAdapter advertises wallet capabilities', () => {
  expectTypeOf<AlbedoAdapter['capabilities']>().toEqualTypeOf<WalletCapabilities>()
})
