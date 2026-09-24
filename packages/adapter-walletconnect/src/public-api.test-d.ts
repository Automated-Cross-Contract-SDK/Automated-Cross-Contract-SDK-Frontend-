/**
 * Type-level public API surface test for `@soroban-resurrect/adapter-walletconnect`.
 *
 * Run with: `npm run test:types -w packages/adapter-walletconnect`
 */
import { expectTypeOf, test } from 'vitest'
import * as wc from './index.js'
import { WalletConnectAdapter } from './index.js'
import type { WalletConnectAdapterOptions } from './index.js'
import type { WalletAdapter, WalletCapabilities } from '@soroban-resurrect/sdk'

type PublicExports =
  | 'STELLAR_WC_METHODS'
  | 'STELLAR_WC_CHAINS'
  | 'passphraseToChainId'
  | 'parseStellarAccount'
  | 'WalletConnectAdapter'

test('all documented public exports are present', () => {
  expectTypeOf<PublicExports>().toMatchTypeOf<keyof typeof wc>()
})

test('WalletConnectAdapter satisfies the SDK WalletAdapter contract', () => {
  expectTypeOf<WalletConnectAdapter>().toMatchTypeOf<WalletAdapter>()
  expectTypeOf<WalletConnectAdapter['isConnected']>().returns.toEqualTypeOf<Promise<boolean>>()
  expectTypeOf<WalletConnectAdapter['capabilities']>().toEqualTypeOf<WalletCapabilities>()
})

test('adapter options are pinned', () => {
  expectTypeOf<WalletConnectAdapterOptions>().not.toBeAny()
  expectTypeOf(wc.parseStellarAccount).toBeFunction()
  expectTypeOf(wc.passphraseToChainId).toBeFunction()
})
