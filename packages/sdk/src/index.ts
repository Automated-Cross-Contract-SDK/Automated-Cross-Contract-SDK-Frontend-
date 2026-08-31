/**
 * @soroban-resurrect/sdk — Public API barrel
 *
 * Only the symbols listed here are considered part of the stable public API.
 * Internal helpers (Archiver, Restorer, Executor, Authorization, SimulationCache)
 * are intentionally NOT exported; consumers should use the high-level
 * `SorobanResurrect` class instead.
 */

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------
export { SorobanResurrect } from './SorobanResurrect.js'

// ---------------------------------------------------------------------------
// Network presets / switching helper
// ---------------------------------------------------------------------------
export { SorobanResurrectNetwork, NETWORK_PRESETS } from './SorobanResurrectNetwork.js'
export type {
  SorobanNetworkName,
  SorobanNetworkPreset,
} from './SorobanResurrectNetwork.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export type {
  SorobanResurrectConfig,
  WalletAdapter,
  WalletCapabilities,
  FeeBumpSponsor,
  FeeBumpConfig,
  HistoryStorage,
  HistoryPersistenceOptions,
  ArchivedLedgerEntry,
  ArchiveDetectionOptions,
  SimulateResponse,
  ResurrectResult,
  TxDiagnostics,
  DryRunResult,
  SubmitWithRestoreOptions,
  RestoreKeysOptions,
  RestoreState,
  RestoreStateInfo,
  SorobanResurrectEvents,
  // Observability (#237)
  Logger,
  LogLevel,
  LogContext,
  RpcTimingEvent,
  // Hardware wallet types
  HardwareWalletAdapter,
  LedgerAdapterConfig,
  TrezorAdapterConfig,
  // Error types
  ResurrectErrorCode,
} from './types.js'
export { ResurrectError } from './errors.js'

// ---------------------------------------------------------------------------
// RPC abstraction layer (dependency injection / testing — see RpcClient.ts)
// ---------------------------------------------------------------------------
export type { ISorobanRpcClient } from './RpcClient.js'
export { SorobanRpcClient, createRpcClient } from './RpcClient.js'

// ---------------------------------------------------------------------------
// Observability — injectable logger + RPC call timings (#237)
// ---------------------------------------------------------------------------
export {
  NOOP_LOGGER,
  resolveLogger,
  isLoggingEnabled,
  createRequestId,
  LoggingRpcClient,
  withRpcLogging,
} from './Logger.js'

// ---------------------------------------------------------------------------
// Account / contract-level archived-entry scan (#239)
// ---------------------------------------------------------------------------
export {
  getExpiringEntriesForContract,
  getExpiringEntriesForAccount,
  DEFAULT_EXPIRING_SOON_LEDGERS,
} from './ContractScan.js'
export type {
  ContractScanOptions,
  ContractScanResult,
  AccountScanOptions,
  AccountScanResult,
  ClassicEntryStatus,
} from './ContractScan.js'

// ---------------------------------------------------------------------------
// Multisig restore support (#240)
// ---------------------------------------------------------------------------
export { MultiSigWalletAdapter } from './MultiSigWalletAdapter.js'
export type {
  MultiSigSigner,
  MultiSigConfig,
  SignatureCollectionResult,
} from './MultiSigWalletAdapter.js'

// ---------------------------------------------------------------------------
// State machine utilities (proactive / estimation states — #238)
// ---------------------------------------------------------------------------
export { isProcessingState, PROCESSING_STATES } from './stateUtils.js'

// ---------------------------------------------------------------------------
// Wallet-adapter factory
// ---------------------------------------------------------------------------
export { createAdapter, isKnownWallet, SUPPORTED_WALLETS } from './createAdapter.js'
export type { KnownWallet, AdapterImporter, CreateAdapterOptions } from './createAdapter.js'

// ---------------------------------------------------------------------------
// Branded-type cast helpers
//
// Needed by first-party wallet adapter packages (adapter-freighter, -xbull,
// -albedo, -lobstr) to brand the plain strings returned by the underlying
// wallet libraries at the SDK boundary.
// ---------------------------------------------------------------------------
export { asStellarPublicKey, asXdrBase64 } from './branded-types.js'

// ---------------------------------------------------------------------------
// On-chain failure parsing (populates ResurrectResult.onchainError)
// ---------------------------------------------------------------------------
export { parseTransactionFailure } from './TransactionFailure.js'
export type { ParsableTransactionResponse } from './TransactionFailure.js'

// ---------------------------------------------------------------------------
// TTL / ledger entry helpers (returned by SorobanResurrect.queryLedgerTTL etc.)
// ---------------------------------------------------------------------------
export type { LedgerEntryTTLInfo, TTLQueryResult, LedgerKeyEntryType } from './TTLHelpers.js'

// ---------------------------------------------------------------------------
// Fee calculation (returned by SorobanResurrect.estimateRestoreCost)
// ---------------------------------------------------------------------------
export type { RestoreCostEstimate } from './feeCalculation.js'

// ---------------------------------------------------------------------------
// Network presets (used by SorobanResurrect.switchNetwork)
// ---------------------------------------------------------------------------
export type { SorobanNetworkName, SorobanNetworkPreset } from './constants.js'
export { NETWORK_PRESETS } from './constants.js'

// ---------------------------------------------------------------------------
// RPC client abstraction (dependency injection / resilient transport)
// ---------------------------------------------------------------------------
export type { ISorobanRpcClient, RpcResilienceOptions } from './RpcClient.js'
export { SorobanRpcClient, createRpcClient, RpcTimeoutError, RpcCircuitOpenError } from './RpcClient.js'

// ---------------------------------------------------------------------------
// Transaction history (returned by SorobanResurrect.history / getHistory)
// ---------------------------------------------------------------------------
export type { TransactionHistoryEntry, TransactionAttemptStatus } from './TransactionHistory.js'

// ---------------------------------------------------------------------------
// Hardware wallet adapters
// ---------------------------------------------------------------------------
export {
  LedgerWalletAdapter,
  TrezorWalletAdapter,
  createLedgerAdapter,
  createTrezorAdapter,
} from './HardwareWalletAdapters.js'

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------
export {
  SDK_DEFAULTS,
  DEFAULT_NETWORK_PASSPHRASE,
  DEFAULT_RPC_URL,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  RESTORE_FEE_MULTIPLIER,
  SOROBAN_MAX_TX_XDR_BYTES,
  RESTORE_TX_SIZE_WARN_RATIO,
  KNOWN_NETWORK_PASSPHRASES,
  resolveNetworkPassphrase,
} from './constants.js'
export type { SdkDefaults } from './constants.js'

// ---------------------------------------------------------------------------
// Restore footprint-size guard
// ---------------------------------------------------------------------------
export {
  estimateRestoreTxSizeBytes,
  evaluateRestoreFootprint,
  restoreSizeGuidance,
} from './footprintGuard.js'
export type {
  RestoreTxDiagnostics,
  EvaluateRestoreFootprintOptions,
} from './footprintGuard.js'

// ---------------------------------------------------------------------------
// Typed event emitter (used by SorobanResurrect.on / once / off)
// ---------------------------------------------------------------------------
export {
  walletMaySupport,
  walletDeclares,
  assertWalletCapability,
  walletMaxOperations,
} from './walletCapabilities.js'
export type { BooleanWalletCapability } from './walletCapabilities.js'

export { TypedEventEmitter } from './EventEmitter.js'
export {
  ok,
  err,
  some,
  none,
  toResult,
  toResultAsync,
  fromNullable,
  extractArchivedKeysSafe,
  extractFootprintFromSuccessSafe,
} from './result.js'
export type { Result, Option } from './result.js'
export { resolveConfig } from './SorobanResurrectConfig.js'
export type { ResolvedConfig } from './SorobanResurrectConfig.js'
export { SorobanResurrectStateManager } from './SorobanResurrectState.js'
export { isProcessingState } from './stateUtils.js'
export { SorobanResurrectSimulator } from './SorobanResurrectSimulation.js'
export { SorobanResurrectExecutor } from './SorobanResurrectExecution.js'
export {
  queryLedgerTTL,
  queryLedgerEntryTTL,
  getExpiringSoonEntries,
  getArchivedEntries,
  getLedgerKeyEntryType,
} from './TTLHelpers.js'
export type { TransactionHistoryEntry, TransactionAttemptStatus } from './TransactionHistory.js'
export { TransactionHistory } from './TransactionHistory.js'
export type { ISorobanRpcClient } from './RpcClient.js'
export type { TTLWatchOptions, TTLWatchHandle } from './TTLWatch.js'
