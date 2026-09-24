/**
 * Type-level public API surface test for `@soroban-resurrect/sdk`.
 *
 * These assertions fail to *compile* if a public export is renamed, removed,
 * or changes shape — a type-level signal for breaking API changes that the
 * behavioural unit tests would not catch.
 *
 * Run with: `npm run test:types -w packages/sdk`
 */
import { expectTypeOf, test } from 'vitest'
import * as sdk from '../index.js'
import type {
  WalletAdapter,
  WalletCapabilities,
  ResurrectResult,
  SorobanResurrectConfig,
  RestoreState,
  RestoreStateInfo,
  SorobanResurrectEvents,
  SubmitWithRestoreOptions,
  ArchivedLedgerEntry,
  HardwareWalletAdapter,
  FeeBumpSponsor,
  DryRunResult,
  TxDiagnostics,
  ISorobanRpcClient,
  KnownWallet,
  ContractScanResult,
  AccountScanResult,
  MultiSigSigner,
  MultiSigConfig,
  TransactionHistoryEntry,
  LedgerEntryTTLInfo,
  RestoreCostEstimate,
} from '../index.js'

/**
 * Every symbol documented as part of the stable public barrel. If one is
 * removed or renamed, the `keyof typeof sdk` assertion below stops compiling.
 */
type PublicExports =
  | 'SorobanResurrect'
  | 'SorobanResurrectNetwork'
  | 'NETWORK_PRESETS'
  | 'ResurrectError'
  | 'createAdapter'
  | 'isKnownWallet'
  | 'SUPPORTED_WALLETS'
  | 'asStellarPublicKey'
  | 'asXdrBase64'
  | 'isProcessingState'
  | 'PROCESSING_STATES'
  | 'MultiSigWalletAdapter'
  | 'LedgerWalletAdapter'
  | 'TrezorWalletAdapter'
  | 'createLedgerAdapter'
  | 'createTrezorAdapter'
  | 'parseTransactionFailure'
  | 'getExpiringEntriesForContract'
  | 'getExpiringEntriesForAccount'
  | 'DEFAULT_EXPIRING_SOON_LEDGERS'
  | 'walletMaySupport'
  | 'walletDeclares'
  | 'assertWalletCapability'
  | 'walletMaxOperations'
  | 'TypedEventEmitter'
  | 'ok'
  | 'err'
  | 'some'
  | 'none'
  | 'toResult'
  | 'toResultAsync'
  | 'fromNullable'
  | 'extractArchivedKeysSafe'
  | 'extractFootprintFromSuccessSafe'
  | 'resolveConfig'
  | 'SorobanResurrectStateManager'
  | 'SorobanResurrectSimulator'
  | 'SorobanResurrectExecutor'
  | 'queryLedgerTTL'
  | 'queryLedgerEntryTTL'
  | 'getExpiringSoonEntries'
  | 'getArchivedEntries'
  | 'getLedgerKeyEntryType'
  | 'TransactionHistory'
  | 'SorobanRpcClient'
  | 'createRpcClient'
  | 'SDK_DEFAULTS'
  | 'DEFAULT_NETWORK_PASSPHRASE'
  | 'DEFAULT_RPC_URL'
  | 'POLL_INTERVAL_MS'
  | 'POLL_TIMEOUT_MS'
  | 'RESTORE_FEE_MULTIPLIER'
  | 'SOROBAN_MAX_TX_XDR_BYTES'
  | 'RESTORE_TX_SIZE_WARN_RATIO'
  | 'KNOWN_NETWORK_PASSPHRASES'
  | 'resolveNetworkPassphrase'
  | 'estimateRestoreTxSizeBytes'
  | 'evaluateRestoreFootprint'
  | 'restoreSizeGuidance'
  | 'NOOP_LOGGER'
  | 'resolveLogger'
  | 'isLoggingEnabled'
  | 'createRequestId'
  | 'LoggingRpcClient'
  | 'withRpcLogging'

test('all documented public exports are present on the barrel', () => {
  expectTypeOf<PublicExports>().toMatchTypeOf<keyof typeof sdk>()
})

test('exported constants keep their types', () => {
  expectTypeOf(sdk.SDK_DEFAULTS).not.toBeAny()
  expectTypeOf(sdk.DEFAULT_NETWORK_PASSPHRASE).toEqualTypeOf<string>()
  expectTypeOf(sdk.DEFAULT_RPC_URL).toEqualTypeOf<string>()
  expectTypeOf(sdk.POLL_INTERVAL_MS).toEqualTypeOf<number>()
  expectTypeOf(sdk.POLL_TIMEOUT_MS).toEqualTypeOf<number>()
  expectTypeOf(sdk.RESTORE_FEE_MULTIPLIER).toEqualTypeOf<number>()
  expectTypeOf(sdk.SOROBAN_MAX_TX_XDR_BYTES).toEqualTypeOf<number>()
  expectTypeOf(sdk.RESTORE_TX_SIZE_WARN_RATIO).toEqualTypeOf<number>()
  expectTypeOf(sdk.KNOWN_NETWORK_PASSPHRASES).not.toBeAny()
  expectTypeOf(sdk.resolveNetworkPassphrase).toBeFunction()
})

test('WalletAdapter keeps its core contract', () => {
  expectTypeOf<WalletAdapter>().toHaveProperty('isConnected')
  expectTypeOf<WalletAdapter>().toHaveProperty('getPublicKey')
  expectTypeOf<WalletAdapter>().toHaveProperty('signTransaction')

  expectTypeOf<WalletAdapter['isConnected']>().returns.toEqualTypeOf<Promise<boolean>>()
  expectTypeOf<Awaited<ReturnType<WalletAdapter['getPublicKey']>>>().toMatchTypeOf<string>()
  expectTypeOf<Awaited<ReturnType<WalletAdapter['signTransaction']>>>().toMatchTypeOf<string>()
  expectTypeOf<WalletAdapter['capabilities']>().toEqualTypeOf<WalletCapabilities | undefined>()
})

test('HardwareWalletAdapter extends WalletAdapter', () => {
  expectTypeOf<HardwareWalletAdapter>().toMatchTypeOf<WalletAdapter>()
  expectTypeOf<HardwareWalletAdapter['type']>().toEqualTypeOf<'ledger' | 'trezor'>()
  expectTypeOf<HardwareWalletAdapter['connect']>().returns.toEqualTypeOf<Promise<void>>()
  expectTypeOf<HardwareWalletAdapter['disconnect']>().returns.toEqualTypeOf<Promise<void>>()
})

test('SorobanResurrectConfig and result types keep their shape', () => {
  expectTypeOf<SorobanResurrectConfig>().toHaveProperty('rpcUrl')
  expectTypeOf<SorobanResurrectConfig['rpcUrl']>().toMatchTypeOf<string>()
  expectTypeOf<SorobanResurrectConfig['rpcClient']>().toEqualTypeOf<ISorobanRpcClient | undefined>()

  expectTypeOf<ResurrectResult['success']>().toEqualTypeOf<boolean>()
  expectTypeOf<ResurrectResult['archivedKeysDetected']>().toEqualTypeOf<number>()
  expectTypeOf<ResurrectResult['error']>().toEqualTypeOf<string | undefined>()

  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('transaction')
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('wallet')
  expectTypeOf<ArchivedLedgerEntry>().toHaveProperty('keyBase64')

  expectTypeOf<FeeBumpSponsor>().toHaveProperty('signFeeBump')
  expectTypeOf<DryRunResult>().toHaveProperty('wouldNeedRestore')
  expectTypeOf<TxDiagnostics>().toHaveProperty('events')
})

test('RestoreState union and typed events are pinned', () => {
  expectTypeOf<RestoreState>().toMatchTypeOf<
    | 'idle'
    | 'simulating'
    | 'restore_needed'
    | 'signing_restore'
    | 'submitting_restore'
    | 'confirming_restore'
    | 'signing_original'
    | 'submitting_original'
    | 'success'
    | 'error'
    | 'estimating'
    | 'watching_ttl'
    | 'extending_ttl'
  >()

  expectTypeOf<RestoreStateInfo['state']>().toEqualTypeOf<RestoreState>()
  expectTypeOf<SorobanResurrectEvents>().toHaveProperty('restoreComplete')
  expectTypeOf<SorobanResurrectEvents['restoreComplete']>().toEqualTypeOf<ResurrectResult>()
  expectTypeOf<SorobanResurrectEvents['error']>().toEqualTypeOf<string>()
})

test('scan / multisig / history / TTL public types exist', () => {
  expectTypeOf<ContractScanResult>().toHaveProperty('archived')
  expectTypeOf<ContractScanResult>().toHaveProperty('expiringSoon')
  expectTypeOf<AccountScanResult>().toHaveProperty('missing')
  expectTypeOf<MultiSigSigner>().not.toBeAny()
  expectTypeOf<MultiSigConfig>().not.toBeAny()
  expectTypeOf<KnownWallet>().not.toBeAny()
  expectTypeOf<TransactionHistoryEntry>().not.toBeAny()
  expectTypeOf<LedgerEntryTTLInfo>().not.toBeAny()
  expectTypeOf<RestoreCostEstimate>().not.toBeAny()
})
