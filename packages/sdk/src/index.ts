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
  RestoreKeysOptions,
  RestoreState,
  RestoreStateInfo,
  SorobanResurrectEvents,
  // Hardware wallet types
  HardwareWalletAdapter,
  LedgerAdapterConfig,
  TrezorAdapterConfig,
} from './types.js'

// ---------------------------------------------------------------------------
// TTL / ledger entry helpers (returned by SorobanResurrect.queryLedgerTTL etc.)
// ---------------------------------------------------------------------------
export type { LedgerEntryTTLInfo, TTLQueryResult, LedgerKeyEntryType } from './TTLHelpers.js'

// ---------------------------------------------------------------------------
// Transaction history (returned by SorobanResurrect.history / getHistory)
// ---------------------------------------------------------------------------
export type { TransactionHistoryEntry, TransactionAttemptStatus } from './TransactionHistory.js'

// ---------------------------------------------------------------------------
// RPC client abstraction (dependency injection / test doubles)
// ---------------------------------------------------------------------------
export type { ISorobanRpcClient } from './RpcClient.js'
export { SorobanRpcClient, createRpcClient } from './RpcClient.js'

// ---------------------------------------------------------------------------
// Ledger key / archive helpers (contractData and contractCode entries)
// ---------------------------------------------------------------------------
export {
  buildContractDataKey,
  checkArchivedContractData,
  getContractDataEntry,
  buildContractCodeKey,
  checkArchivedContractCode,
  getContractCodeEntry,
} from './Archiver.js'

// ---------------------------------------------------------------------------
// Restore fee-cap error (thrown by buildRestoreTransaction / restoreKeys
// when the computed fee exceeds config.maxRestoreFeeStroops)
// ---------------------------------------------------------------------------
export { RestoreFeeCapExceededError } from './Restorer.js'

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
export {
  queryLedgerTTL,
  queryLedgerEntryTTL,
  getExpiringSoonEntries,
  getArchivedEntries,
  getLedgerKeyEntryType,
} from './TTLHelpers.js'
export { TransactionHistory } from './TransactionHistory.js'
export { isProcessingState, PROCESSING_STATES } from './stateUtils.js'
