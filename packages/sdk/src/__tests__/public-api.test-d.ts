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
import { xdr } from '@stellar/stellar-sdk'
import * as sdk from '../index.js'
import type {
  WalletAdapter,
  WalletCapabilities,
  ResurrectResult,
  ResurrectFailure,
  SorobanResurrectConfig,
  RestoreState,
  RestoreStateInfo,
  SorobanResurrectEvents,
  SubmitWithRestoreOptions,
  AbortSignalOptions,
  ArchivedLedgerEntry,
  HardwareWalletAdapter,
  FeeBumpSponsor,
  DryRunResult,
  RebuildTimeBounds,
  ExpiredTransactionInfo,
  TxDiagnostics,
  ISorobanRpcClient,
  KnownWallet,
  ContractScanResult,
  AccountScanResult,
  MultiSigSigner,
  MultiSigConfig,
  TransactionHistoryEntry,
  LedgerEntryTTLInfo,
  LedgerEntryStatus,
  RestoreCostEstimate,
  ConfirmationPolicy,
  ConfirmationTimeoutBehavior,
  SubmitRetryOptions,
  SubmitLifecycleEvent,
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
  | 'OriginalTransactionExpiredError'
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
  | 'RESTORE_TX_LEDGER_BOUNDS_WINDOW'
  | 'checkNetworkCapabilities'
  | 'MIN_RESTORE_PROTOCOL_VERSION'
  | 'IncompleteFootprintError'
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
  | 'serializeLedgerKey'

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
  expectTypeOf<ResurrectResult['failure']>().toEqualTypeOf<ResurrectFailure | undefined>()
  expectTypeOf<ResurrectResult['expiredTransaction']>().toEqualTypeOf<
    ExpiredTransactionInfo | undefined
  >()
  expectTypeOf<ResurrectFailure['retryable']>().toEqualTypeOf<boolean>()
  expectTypeOf<ResurrectFailure['nextStep']>().toEqualTypeOf<string>()

  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('transaction')
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('wallet')
  expectTypeOf<AbortSignalOptions['signal']>().toEqualTypeOf<AbortSignal | undefined>()
  expectTypeOf<Parameters<SorobanResurrect['submitWithRestore']>[0]>().toHaveProperty('signal')
  expectTypeOf<Parameters<SorobanResurrect['retry']>[2]>().toMatchTypeOf<AbortSignalOptions>()
  expectTypeOf<Parameters<SorobanResurrect['sendTransaction']>[2]>().toMatchTypeOf<AbortSignalOptions>()
  expectTypeOf<
    Parameters<SorobanResurrect['submitBatchWithRestore']>[1]
  >().toMatchTypeOf<AbortSignalOptions>()
  expectTypeOf<Parameters<SorobanResurrect['restoreKeys']>[2]>().toHaveProperty('signal')
  expectTypeOf<
    Parameters<SorobanResurrect['buildRestoreTx']>[3]
  >().toMatchTypeOf<AbortSignalOptions>()
  expectTypeOf<
    Parameters<SorobanResurrect['buildBatchRestoreTx']>[2]
  >().toMatchTypeOf<AbortSignalOptions>()
  expectTypeOf<ArchivedLedgerEntry>().toHaveProperty('keyBase64')

  expectTypeOf<FeeBumpSponsor>().toHaveProperty('signFeeBump')
  expectTypeOf<DryRunResult>().toHaveProperty('wouldNeedRestore')
  expectTypeOf<DryRunResult>().toHaveProperty('intendedOperations')
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('dryRun')
  expectTypeOf<InstanceType<typeof sdk.SorobanResurrect>>().toHaveProperty('previewRestore')
  expectTypeOf<RebuildTimeBounds>().toHaveProperty('maxTime')
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('rebuildTimeBounds')
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('approveExpiredRebuild')
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
  expectTypeOf<LedgerEntryTTLInfo['status']>().toEqualTypeOf<LedgerEntryStatus>()
  expectTypeOf<LedgerEntryStatus>().toEqualTypeOf<
    'healthy' | 'near-expiry' | 'archived' | 'unknown'
  >()
  expectTypeOf<RestoreCostEstimate>().not.toBeAny()
})

test('recovery policies and lifecycle types are stable public types', () => {
  expectTypeOf<ConfirmationPolicy>().toEqualTypeOf<
    'wait-for-finality' | 'return-on-submission'
  >()
  expectTypeOf<ConfirmationTimeoutBehavior>().toEqualTypeOf<'error' | 'return-pending'>()
  expectTypeOf<SubmitRetryOptions>().toHaveProperty('maxRetries')
  expectTypeOf<SubmitLifecycleEvent['phase']>().toMatchTypeOf<string>()
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('requestId')
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('confirmationPolicy')
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('confirmationTimeoutMs')
  expectTypeOf<SubmitWithRestoreOptions>().toHaveProperty('confirmationTimeoutBehavior')
})
