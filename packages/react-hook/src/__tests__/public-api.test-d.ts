/**
 * Type-level public API surface test for `@soroban-resurrect/react-hook`.
 *
 * Pins the exported hooks and the shape of every public return type, so a
 * breaking change to a hook's return value is caught at compile time.
 *
 * Run with: `npm run test:types -w packages/react-hook`
 */
import { expectTypeOf, test } from 'vitest'
import * as hook from '../index.js'
import type {
  UseSorobanResurrectReturn,
  UseSorobanResurrectSubmitReturn,
  UseRestoreWatcherReturn,
  UseSorobanResurrectNetworkReturn,
  RestoreWatchStatus,
  SorobanResurrectProviderProps,
  ResolvedResurrectOptions,
} from '../index.js'
import type {
  RestoreStateInfo,
  ResurrectResult,
  ArchivedLedgerEntry,
  WalletAdapter,
  LedgerEntryTTLInfo,
  SorobanNetworkName,
} from '@soroban-resurrect/sdk'
import type { Transaction } from '@stellar/stellar-sdk'

type PublicExports =
  | 'SorobanResurrectProvider'
  | 'useSorobanResurrectContext'
  | 'useOptionalSorobanResurrectContext'
  | 'SorobanResurrectContext'
  | 'useSorobanResurrect'
  | 'useSorobanResurrectSubmit'
  | 'useRestoreWatcher'
  | 'useSorobanResurrectNetwork'

test('all documented public exports are present', () => {
  expectTypeOf<PublicExports>().toMatchTypeOf<keyof typeof hook>()
})

test('useSorobanResurrect return shape', () => {
  expectTypeOf<UseSorobanResurrectReturn>().toHaveProperty('state')
  expectTypeOf<UseSorobanResurrectReturn['state']>().toEqualTypeOf<RestoreStateInfo>()
  expectTypeOf<UseSorobanResurrectReturn['isProcessing']>().toEqualTypeOf<boolean>()
  expectTypeOf<UseSorobanResurrectReturn['submitWithRestore']>().returns.toEqualTypeOf<
    Promise<ResurrectResult>
  >()
  expectTypeOf<UseSorobanResurrectReturn['detectArchivedKeys']>().returns.toEqualTypeOf<
    Promise<ArchivedLedgerEntry[]>
  >()
  expectTypeOf<UseSorobanResurrectReturn>().toHaveProperty('resurrect')
  expectTypeOf<UseSorobanResurrectReturn>().toHaveProperty('on')
})

test('useSorobanResurrectSubmit return shape', () => {
  expectTypeOf<Parameters<UseSorobanResurrectSubmitReturn['submit']>>().toEqualTypeOf<
    [transaction: Transaction, wallet: WalletAdapter]
  >()
  expectTypeOf<UseSorobanResurrectSubmitReturn['isProcessing']>().toEqualTypeOf<boolean>()
  expectTypeOf<UseSorobanResurrectSubmitReturn['result']>().toEqualTypeOf<ResurrectResult | null>()
  expectTypeOf<UseSorobanResurrectSubmitReturn['error']>().toEqualTypeOf<string | null>()
  expectTypeOf<UseSorobanResurrectSubmitReturn['state']>().toEqualTypeOf<RestoreStateInfo>()
  expectTypeOf<UseSorobanResurrectSubmitReturn['reset']>().returns.toEqualTypeOf<void>()
})

test('useRestoreWatcher return shape', () => {
  expectTypeOf<UseRestoreWatcherReturn['expiringSoon']>().toEqualTypeOf<LedgerEntryTTLInfo[]>()
  expectTypeOf<UseRestoreWatcherReturn['watchStatus']>().toEqualTypeOf<RestoreWatchStatus>()
  expectTypeOf<RestoreWatchStatus>().toEqualTypeOf<'idle' | 'watching' | 'stopped' | 'error'>()
  expectTypeOf<UseRestoreWatcherReturn['lastCheckedAt']>().toEqualTypeOf<number | null>()
  expectTypeOf<UseRestoreWatcherReturn['start']>().returns.toEqualTypeOf<void>()
  expectTypeOf<UseRestoreWatcherReturn['extend']>().returns.toEqualTypeOf<
    Promise<ResurrectResult | null>
  >()
})

test('useSorobanResurrectNetwork return shape', () => {
  expectTypeOf<UseSorobanResurrectNetworkReturn['network']>().toEqualTypeOf<SorobanNetworkName>()
  expectTypeOf<UseSorobanResurrectNetworkReturn['presets']>().not.toBeAny()
  expectTypeOf<UseSorobanResurrectNetworkReturn['switchNetwork']>().returns.toEqualTypeOf<void>()
  expectTypeOf<UseSorobanResurrectNetworkReturn['isProcessing']>().toEqualTypeOf<boolean>()
})

test('provider props and shared option types exist', () => {
  expectTypeOf<SorobanResurrectProviderProps>().toHaveProperty('children')
  expectTypeOf<SorobanResurrectProviderProps>().toHaveProperty('config')
  expectTypeOf<ResolvedResurrectOptions>().toHaveProperty('config')
  expectTypeOf<ResolvedResurrectOptions>().toHaveProperty('resurrect')
})
