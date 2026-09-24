/**
 * Type-level public API surface test for `@soroban-resurrect/adapter-xbull`.
 *
 * Run with: `npm run test:types -w packages/adapter-xbull`
 */
import { expectTypeOf, test } from 'vitest'
import { XBullAdapter } from './index.js'
import type { WalletAdapter, WalletCapabilities } from '@soroban-resurrect/sdk'

test('XBullAdapter satisfies the SDK WalletAdapter contract', () => {
  expectTypeOf<XBullAdapter>().toMatchTypeOf<WalletAdapter>()
  expectTypeOf<XBullAdapter['isConnected']>().returns.toEqualTypeOf<Promise<boolean>>()
  expectTypeOf<XBullAdapter['getPublicKey']>().returns.toMatchTypeOf<Promise<unknown>>()
  expectTypeOf<XBullAdapter['signTransaction']>().toBeFunction()
})

test('XBullAdapter advertises wallet capabilities', () => {
  expectTypeOf<XBullAdapter['capabilities']>().toEqualTypeOf<WalletCapabilities>()
})
