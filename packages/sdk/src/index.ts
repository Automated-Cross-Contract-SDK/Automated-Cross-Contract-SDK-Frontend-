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
  // Hardware wallet types
  HardwareWalletAdapter,
  LedgerAdapterConfig,
  TrezorAdapterConfig,
} from './types.js'

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
