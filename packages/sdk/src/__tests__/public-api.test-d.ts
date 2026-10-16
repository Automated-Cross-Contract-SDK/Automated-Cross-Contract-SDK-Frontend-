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
  SorobanNetworkName,
  SorobanNetworkPreset,
  WalletAdapter,
  WalletCapabilities,
  ResolvedSorobanResurrectConfig,
  SdkRuntime,
  FeeBumpConfig,
  HistoryStorage,
  HistoryPersistenceOptions,
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
  ResurrectFailure,
  ResurrectSuccess,
  ResurrectErrorCode,
  LogLevel,
  LogContext,
  RpcTimingEvent,
  ArchiveDetectionOptions,
  RestoreKeysOptions,
  RpcResilienceOptions,
  ContractScanOptions,
  ClassicEntryStatus,
  SignatureCollectionResult,
  AdapterImporter,
  CreateAdapterOptions,
  ParsableTransactionResponse,
  TTLQueryResult,
  LedgerKeyEntryType,
  QueryLedgerTTLOptions,
  ChunkedFetchOptions,
  TTLWatchOptions,
  TTLWatchHandle,
  TransactionAttemptStatus,
  SdkDefaults,
  RestoreTxDiagnostics,
  EvaluateRestoreFootprintOptions,
  HistoryPersistenceMode,
  HistorySerializer,
  AttachHistoryPersistenceOptions,
  MinimalHistoryEntry,
  Result,
  Option,
} from '../index.js'

/**
 * Every symbol documented as part of the stable public barrel. If one is
 * removed or renamed, the `keyof typeof sdk` assertion below stops compiling.
 */
type PublicExports =
  | 'SorobanResurrect'
  | 'SYSTEM_RUNTIME'
  | 'SorobanResurrectNetwork'
  | 'NETWORK_PRESETS'
  | 'WalletError'
  | 'ResurrectErrorCode'
  | 'getResurrectErrorCode'
  | 'ResurrectError'
  | 'RestoreFeeExceededError'
  | 'NetworkError'
  | 'SimulationError'
  | 'SigningError'
  | 'RestoreError'
  | 'ResurrectTimeoutError'
  | 'InvalidInputError'
  | 'SorobanRpcClient'
  | 'createRpcClient'
  | 'RpcTimeoutError'
  | 'RpcCircuitOpenError'
  | 'NOOP_LOGGER'
  | 'resolveLogger'
  | 'isLoggingEnabled'
  | 'createRequestId'
  | 'LoggingRpcClient'
  | 'withRpcLogging'
  | 'getExpiringEntriesForContract'
  | 'getExpiringEntriesForAccount'
  | 'DEFAULT_EXPIRING_SOON_LEDGERS'
  | 'MultiSigWalletAdapter'
  | 'isProcessingState'
  | 'PROCESSING_STATES'
  | 'createAdapter'
  | 'isKnownWallet'
  | 'SUPPORTED_WALLETS'
  | 'asStellarPublicKey'
  | 'asXdrBase64'
  | 'parseTransactionFailure'
  | 'getCachedLatestLedger'
  | 'invalidateLatestLedgerCache'
  | 'LATEST_LEDGER_CACHE_MS'
  | 'fetchLedgerEntriesChunked'
  | 'watchTTL'
  | 'DEFAULT_MAX_HISTORY_ENTRIES'
  | 'LedgerWalletAdapter'
  | 'TrezorWalletAdapter'
  | 'createLedgerAdapter'
  | 'createTrezorAdapter'
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
  | 'parseMinimalHistory'
  | 'Ok'
  | 'Err'
  | 'Some'
  | 'None'
  | 'ok'
  | 'err'
  | 'some'
  | 'none'
  | 'isOk'
  | 'isErr'
  | 'isSome'
  | 'isNone'
  | 'isResurrectSuccess'
  | 'isResurrectFailure'
  | 'matchResurrectResult'
  | 'toError'
  | 'toResult'
  | 'toResultAsync'
  | 'fromNullable'
  | 'extractArchivedKeysSafe'
  | 'extractFootprintFromSuccessSafe'

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

test('workflow results expose typed success and failure branches', () => {
  expectTypeOf<ResurrectSuccess['success']>().toEqualTypeOf<true>()
  expectTypeOf<ResurrectFailure['success']>().toEqualTypeOf<false>()
  expectTypeOf<ResurrectFailure['errorCode']>().toEqualTypeOf<ResurrectErrorCode>()
  expectTypeOf<ResurrectFailure['error']>().toEqualTypeOf<string>()
})

test('runtime injection and compatibility types remain concrete', () => {
  expectTypeOf<SdkRuntime['now']>().returns.toEqualTypeOf<number>()
  expectTypeOf<SdkRuntime['random']>().returns.toEqualTypeOf<number>()
  expectTypeOf<ResolvedSorobanResurrectConfig['runtime']>().toEqualTypeOf<SdkRuntime>()
  expectTypeOf<HistorySerializer['serialize']>().returns.toEqualTypeOf<string | Promise<string>>()
})

function verifyResultNarrowing(result: ResurrectResult): void {
  if (sdk.isResurrectFailure(result)) {
    expectTypeOf(result.errorCode).toEqualTypeOf<ResurrectErrorCode>()
    expectTypeOf(result.error).toEqualTypeOf<string>()
  } else {
    expectTypeOf(result.success).toEqualTypeOf<true>()
    expectTypeOf(result.originalTxHash).toEqualTypeOf<ResurrectSuccess['originalTxHash']>()
  }
}

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
