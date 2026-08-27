export { SorobanResurrect } from './SorobanResurrect.js'
export { executeWithRestore, sendTransaction } from './Executor.js'
export {
  categorizeAuthEntries,
  signAuthorizationEntries,
  attachAuthorizationEntries,
  hashAuthorizationEntry,
  requiresAddressAuthorization,
  getAddressAuthEntries,
} from './Authorization.js'
export type {
  CategorizedAuthEntry,
  AuthorizationWalletAdapter,
  AttachAuthorizationOptions,
  SignAuthorizationEntriesOptions,
} from './Authorization.js'
export {
  isRestoreResponse,
  isSuccessResponse,
  isErrorResponse,
  extractArchivedKeys,
  extractFootprintFromSuccess,
  detectArchivedEntries,
  detectArchivedKeysViaSimulation,
  detectArchivedKeysViaDirect,
  buildContractDataKey,
  checkArchivedContractData,
  getContractDataEntry,
} from './Archiver.js'
export {
  buildRestoreTransaction,
  buildOriginalAfterRestore,
  waitForTransaction,
  waitForTransactionSSE,
  prepareTransaction,
  extractXdrOperations,
  buildFeeBumpTransaction,
  submitFeeBumpTransaction,
} from './Restorer.js'
export { SimulationCache } from './SimulationCache.js'
export {
  DEFAULT_NETWORK_PASSPHRASE,
  DEFAULT_RPC_URL,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  RESTORE_FEE_MULTIPLIER,
  KNOWN_NETWORK_PASSPHRASES,
  resolveNetworkPassphrase,
} from './constants.js'
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
} from './types.js'
export { TypedEventEmitter } from './EventEmitter.js'

// ---------------------------------------------------------------------------
// Branded / nominal types — re-exported from types.ts (which re-exports from
// branded-types.ts) so consumers can import everything from one entry point.
// ---------------------------------------------------------------------------
export type {
  TxHash,
  XdrBase64,
  ContractIdHex,
  StellarPublicKey,
  NetworkPassphrase,
  RpcUrl,
  FeeStroops,
  SequenceNumber,
  HistoryEntryId,
} from './types.js'

// Cast / constructor helpers — let consumers brand values at ingest boundaries
// without importing from the internal branded-types module directly.
export {
  asTxHash,
  asXdrBase64,
  asContractIdHex,
  asStellarPublicKey,
  asNetworkPassphrase,
  asRpcUrl,
  asFeeStroops,
  asSequenceNumber,
  asHistoryEntryId,
} from './branded-types.js'
