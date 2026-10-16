import type { Memo, Transaction, rpc } from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from './RpcClient.js'
import type { LedgerEntryTTLInfo as TtlEntryInfo } from './TTLHelpers.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogContext = Record<string, unknown>

export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

export interface EventEmitterOptions {
  logger?: Logger
  maxListeners?: number
}

export const DEFAULT_MAX_LISTENERS = 10

export type EventMap = Record<string, (...args: any[]) => void>

export class TypedEventEmitter<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<(...args: any[]) => void>>()
  private readonly warnedEvents = new Set<keyof Events>()
  private readonly logger: Logger
  private readonly maxListeners: number

  constructor(options: EventEmitterOptions = {}) {
    this.logger = options.logger ?? NOOP_LOGGER
    this.maxListeners = options.maxListeners ?? DEFAULT_MAX_LISTENERS
  }

  on<E extends keyof Events>(event: E, listener: Events[E]): this {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as (...args: any[]) => void)

    if (set.size > this.maxListeners && !this.warnedEvents.has(event)) {
      this.warnedEvents.add(event)
      this.logger.warn(
        `Possible event listener leak detected: "${String(event)}" has ${set.size} listeners (max ${this.maxListeners}).`,
      )
    }

    return this
  }

  off<E extends keyof Events>(event: E, listener: Events[E]): this {
    const set = this.listeners.get(event)
    if (set) {
      set.delete(listener as (...args: any[]) => void)
      if (set.size === 0) this.listeners.delete(event)
    }
    return this
  }

  once<E extends keyof Events>(event: E, listener: Events[E]): this {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper as Events[E])
      ;(listener as (...args: any[]) => void)(...args)
    }
    return this.on(event, wrapper as Events[E])
  }

  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    const set = this.listeners.get(event)
    if (!set || set.size === 0) return false

    for (const listener of Array.from(set)) {
      try {
        ;(listener as (...args: any[]) => void)(...args)
      } catch (error) {
        this.logger.error(`Error in listener for event "${String(event)}":`, error)
      }
    }

    return true
  }

  removeAllListeners<E extends keyof Events>(event?: E): this {
    if (event === undefined) {
      this.listeners.clear()
      this.warnedEvents.clear()
    } else {
      this.listeners.delete(event)
      this.warnedEvents.delete(event)
    }
    return this
  }

  listenerCount<E extends keyof Events>(event: E): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

export type WalletErrorCode =
  'NOT_CONNECTED' | 'USER_REJECTED' | 'NETWORK_MISMATCH' | 'INVALID_STATE' | 'UNKNOWN'

export class WalletError extends Error {
  readonly code: WalletErrorCode
  readonly cause?: unknown

  constructor(code: WalletErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'WalletError'
    this.code = code
    this.cause = cause
  }
}

export interface WalletCapabilities {
  signAuthEntry?: boolean
  feeBump?: boolean
  hardware?: boolean
  maxOperations?: number
}

export interface WalletAdapter {
  readonly capabilities?: WalletCapabilities
  isConnected(): Promise<boolean>
  getPublicKey(): Promise<string> | string
  signTransaction(
    txXdr: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string>
  getNetwork?(): Promise<string>
  signAuthEntry?(
    authEntryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<string>
}

export type HardwareWalletType = 'ledger' | 'trezor'

export interface HardwareWalletAdapter extends WalletAdapter {
  type: HardwareWalletType
  connect(): Promise<void>
  disconnect(): Promise<void>
}

export interface LedgerAdapterConfig {
  transport?: unknown
  accountIndex?: number
  appName?: string
  derivationPath?: string
}

export interface TrezorAdapterConfig {
  manifest?: { email: string; appUrl: string }
  trezorConnect?: unknown
  accountIndex?: number
  appName?: string
}

export interface FeeBumpSponsor {
  signFeeBump(txXdr: string, opts?: { networkPassphrase?: string }): Promise<string>
}

export interface FeeBumpConfig {
  sponsor: FeeBumpSponsor
  feeBumpFee?: string | number
}

export interface HistoryStorage {
  getItem(key: string): Promise<string | null> | string | null
  setItem(key: string, value: string): Promise<void> | void
  removeItem?(key: string): Promise<void> | void
}

export interface HistoryPersistenceOptions {
  storage: HistoryStorage
  key?: string
  mode?: 'full' | 'minimal'
  serializer?: {
    serialize: (plain: string) => string | Promise<string>
    deserialize: (stored: string) => string | Promise<string>
  }
}

export interface ArchiveDetectionOptions {
  chunkSize?: number
  concurrency?: number
  directFallback?: boolean
}

export type SimulateResponse = rpc.Api.SimulateTransactionResponse

export interface ArchivedLedgerEntry {
  keyBase64: string
  keyType?: string
  contractId?: string
  isArchived?: boolean
  archivedAtLedger?: number
  reason?: string
}

export type RestoreState =
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

export interface RestoreStateInfo {
  state: RestoreState
  message: string
  archivedKeys: ArchivedLedgerEntry[]
  error?: string
}

export interface SorobanResurrectEvents {
  stateChange: RestoreStateInfo
  networkChanged: { rpcUrl: string; networkPassphrase: string }
  restoreComplete: ResurrectResult
  error: string
  restoreFailed: string
  restoreNeeded: ArchivedLedgerEntry[]
  restoreSubmitted: string
  restoreConfirmed: string
  originalSubmitted: string
  ttlLow: TtlEntryInfo[]
  ttlExtended: { restoreTxHash: string; entries: TtlEntryInfo[] }
}

export interface RestoreKeysOptions {
  onSigningRestore?: () => void
  onSubmittingRestore?: () => void
  onRestoreSubmitted?: (txHash: string) => void
  onRestoreConfirmed?: (txHash: string) => void
}

export interface SubmitWithRestoreOptions {
  transaction: Transaction
  wallet: WalletAdapter
  feeBumpConfig?: FeeBumpConfig
  restoreTxMemo?: Memo
  restoreTxMemoText?: string
  onSigningRestore?: () => void
  onSubmittingRestore?: () => void
  onRestoreNeeded?: (keys: ArchivedLedgerEntry[]) => void
  onRestoreSubmitted?: (txHash: string) => void
  onRestoreConfirmed?: (txHash: string) => void
  onSigningOriginal?: () => void
  onOriginalSubmitted?: (txHash: string) => void
  onRestoreFailed?: (error: string) => void
  onSigningFeeBump?: () => void
}

export interface ResurrectResult {
  success: boolean
  archivedKeysDetected: number
  error?: string
  errorCode?: ResurrectErrorCode
  txHash?: string
  restoreTxHash?: string
  originalTxHash?: string
  historyId?: string
  onchainError?: string
  diagnostics?: TxDiagnostics
}

export interface TxDiagnostics {
  events: unknown[]
  fee?: string | number
  [key: string]: unknown
}

export interface DryRunResult {
  wouldNeedRestore: boolean
  archivedKeys: ArchivedLedgerEntry[]
  minResourceFee?: number
  error?: string
  [key: string]: unknown
}

export interface SorobanResurrectConfig {
  rpcUrl: string
  networkPassphrase?: string
  rpcClient?: ISorobanRpcClient
  logger?: Logger
  pollIntervalMs?: number
  pollTimeoutMs?: number
  restoreFeeMultiplier?: number
  rpcTimeoutMs?: number
  rpcRetryCount?: number
  rpcRetryBackoffMs?: number
  rpcCircuitBreakerThreshold?: number
  rpcCircuitBreakerCooldownMs?: number
  ttlWatchIntervalMs?: number
  ttlWatchThresholdLedgers?: number
  archiveDetectionMethod?: 'simulation' | 'direct'
  archiveDetectionChunkSize?: number
  archiveDetectionConcurrency?: number
  useSSE?: boolean
  enableSimulationCache?: boolean
  simulationCacheTtlMs?: number
  simulationCacheMaxSize?: number
  persistHistory?: HistoryPersistenceOptions
  maxRestoreFeeStroops?: number | string
  maxRestoreTxSizeBytes?: number
  restoreSizeWarnRatio?: number
  throwOnRestoreSizeLimit?: boolean
  restoreTxMemo?: Memo
  restoreTxMemoText?: string
  ttlWatchAutoExtend?: boolean
  maxSequenceRetries?: number
}

export type TTLQueryStatus = 'live' | 'archived' | 'unknown'

export interface TTLQueryEntry {
  key: string
  status: TTLQueryStatus
  isArchived: boolean
  ttl?: number
}

export interface TTLQueryChunkError {
  chunkIndex: number
  keys: string[]
  error: unknown
}

export interface TTLQueryResult {
  entries: Record<string, TTLQueryEntry>
  failedChunks: TTLQueryChunkError[]
  hasErrors: boolean
}

export interface QueryLedgerTTLOptions {
  keys: string[]
  includeArchived?: boolean
}

export interface LedgerEntryTTLInfo {
  key: string
  ttl: number
  liveUntilLedgerSeq?: number
  status?: TTLQueryStatus
  isArchived?: boolean
}

export type LedgerKeyEntryType = 'contract' | 'account' | 'data' | 'unknown'

export interface RestoreCostEstimate {
  minResourceFee: number
  multiplier: number
  estimatedFee: string
  archivedKeysDetected: number
  wouldNeedRestore: boolean
}

export type RpcTimingEvent = {
  method: string
  url?: string
  durationMs: number
  ok: boolean
  requestId?: string
  error?: string
}

export type ResurrectErrorCode =
  | 'WALLET_NOT_CONNECTED'
  | 'SIMULATION_FAILED'
  | 'RESTORE_FEE_CAP_EXCEEDED'
  | 'RESTORE_TX_PARSE_FAILED'
  | 'RESTORE_TX_FAILED'
  | 'ORIGINAL_TX_PARSE_FAILED'
  | 'ORIGINAL_TX_FAILED'
  | 'UNEXPECTED_SIMULATION_RESPONSE'
  | 'UNSUPPORTED_WALLET_CAPABILITY'
  | 'UNKNOWN_ERROR'

export class ResurrectError extends Error {
  readonly code: ResurrectErrorCode
  constructor(code: ResurrectErrorCode, message: string) {
    super(message)
    this.name = 'ResurrectError'
    this.code = code
  }
}

export class RestoreFeeExceededError extends ResurrectError {
  readonly computedFeeStroops: number
  readonly maxFeeStroops: number

  constructor(computedFeeStroops: number, maxFeeStroops: number) {
    super(
      'UNKNOWN_ERROR',
      `Computed restore fee ${computedFeeStroops} stroops exceeds the configured maxRestoreFeeStroops cap of ${maxFeeStroops} stroops`,
    )
    this.name = 'RestoreFeeExceededError'
    this.computedFeeStroops = computedFeeStroops
    this.maxFeeStroops = maxFeeStroops
  }
}

export interface TransactionHistoryEntry {
  id: string
  hash: string
  ledger?: number
  timestamp: number
  metadata?: Record<string, unknown>
}

export function generateId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
