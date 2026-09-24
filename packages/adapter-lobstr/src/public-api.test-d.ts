/**
 * Type-level public API surface test for `@soroban-resurrect/adapter-lobstr`.
 *
 * Run with: `npm run test:types -w packages/adapter-lobstr`
 */
import { expectTypeOf, test } from 'vitest'
import { LobstrAdapter } from './index.js'
import type { WalletAdapter, WalletCapabilities } from '@soroban-resurrect/sdk'

test('LobstrAdapter satisfies the SDK WalletAdapter contract', () => {
  expectTypeOf<LobstrAdapter>().toMatchTypeOf<WalletAdapter>()
  expectTypeOf<LobstrAdapter['isConnected']>().returns.toEqualTypeOf<Promise<boolean>>()
  expectTypeOf<LobstrAdapter['getPublicKey']>().returns.toMatchTypeOf<Promise<unknown>>()
  expectTypeOf<LobstrAdapter['signTransaction']>().toBeFunction()
})

test('LobstrAdapter advertises wallet capabilities', () => {
  expectTypeOf<LobstrAdapter['capabilities']>().toEqualTypeOf<WalletCapabilities>()
})
