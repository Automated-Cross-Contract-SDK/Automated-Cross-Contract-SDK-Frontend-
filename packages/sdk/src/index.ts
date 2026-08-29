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
// Public types
// ---------------------------------------------------------------------------
export type {
  SorobanResurrectConfig,
  WalletAdapter,
  FeeBumpSponsor,
  FeeBumpConfig,
  ArchivedLedgerEntry,
  SimulateResponse,
  ResurrectResult,
  DryRunResult,
  SubmitWithRestoreOptions,
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
} from './types.js'

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
// TTL / ledger entry helpers (returned by SorobanResurrect.queryLedgerTTL etc.)
// ---------------------------------------------------------------------------
export type { LedgerEntryTTLInfo, TTLQueryResult } from './TTLHelpers.js'

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
  DEFAULT_NETWORK_PASSPHRASE,
  DEFAULT_RPC_URL,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  RESTORE_FEE_MULTIPLIER,
  KNOWN_NETWORK_PASSPHRASES,
  resolveNetworkPassphrase,
} from './constants.js'

// ---------------------------------------------------------------------------
// Typed event emitter (used by SorobanResurrect.on / once / off)
// ---------------------------------------------------------------------------
export { TypedEventEmitter } from './EventEmitter.js'
export { resolveConfig } from './SorobanResurrectConfig.js'
export type { ResolvedConfig } from './SorobanResurrectConfig.js'
export { SorobanResurrectStateManager } from './SorobanResurrectState.js'
export { SorobanResurrectSimulator } from './SorobanResurrectSimulation.js'
export { SorobanResurrectExecutor } from './SorobanResurrectExecution.js'
export type { LedgerEntryTTLInfo, TTLQueryResult } from './TTLHelpers.js'
export {
  queryLedgerTTL,
  queryLedgerEntryTTL,
  getExpiringSoonEntries,
  getArchivedEntries,
} from './TTLHelpers.js'
export type { TransactionHistoryEntry, TransactionAttemptStatus } from './TransactionHistory.js'
export { TransactionHistory } from './TransactionHistory.js'
