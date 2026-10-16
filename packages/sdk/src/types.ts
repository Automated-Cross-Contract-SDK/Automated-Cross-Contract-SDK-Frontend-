import type { Memo, Transaction, xdr } from '@stellar/stellar-sdk';
import type { XdrBase64 } from './branded-types.js';
import type { ISorobanRpcClient } from './RpcClient.js';
import type { ResurrectErrorCode } from './errors.js';

/**
 * Minimal logger interface used across the SDK.
 *
 * Consumers can inject their own implementation via `config.logger`.
 * When no logger is provided the SDK falls back to {@link NOOP_LOGGER}.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * A logger that discards every message. Used as the default when no
 * logger is injected so the SDK never writes to the console on its own.
 */
export const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Resolve the logger to use for a given configuration, falling back to
 * {@link NOOP_LOGGER} when none was provided.
 */
export function resolveLogger(config?: { logger?: Logger }): Logger {
  return config?.logger ?? NOOP_LOGGER;
}

/**
 * Options accepted by {@link TypedEventEmitter}.
 */
export interface EventEmitterOptions {
  /** Optional logger used to report listener failures and leak warnings. */
  logger?: Logger;
  /**
   * Maximum number of listeners allowed for a single event before a leak
   * warning is emitted. Defaults to {@link DEFAULT_MAX_LISTENERS}.
   */
  maxListeners?: number;
}

/** Default listener threshold before a leak warning is emitted. */
export const DEFAULT_MAX_LISTENERS = 10;

/**
 * A typed event map: event name to the listener signature for that event.
 */
export type EventMap = Record<string, (...args: any[]) => void>;

/**
 * A strongly typed event emitter with injectable logging and listener
 * cleanup helpers.
 */
export class TypedEventEmitter<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<(...args: any[]) => void>>();
  private readonly warnedEvents = new Set<keyof Events>();
  private readonly logger: Logger;
  private readonly maxListeners: number;

  constructor(options: EventEmitterOptions = {}) {
    this.logger = options.logger ?? NOOP_LOGGER;
    this.maxListeners = options.maxListeners ?? DEFAULT_MAX_LISTENERS;
  }

  on<E extends keyof Events>(event: E, listener: Events[E]): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);

    if (set.size > this.maxListeners && !this.warnedEvents.has(event)) {
      this.warnedEvents.add(event);
      this.logger.warn(
        `Possible event listener leak detected: "${String(event)}" has ${set.size} listeners ` +
          `(max ${this.maxListeners}).`,
      );
    }

    return this;
  }

  off<E extends keyof Events>(event: E, listener: Events[E]): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  once<E extends keyof Events>(event: E, listener: Events[E]): this {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper as Events[E]);
      (listener as (...args: any[]) => void)(...args);
    };
    return this.on(event, wrapper as Events[E]);
  }

  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      return false;
    }

    for (const listener of Array.from(set)) {
      try {
        (listener as (...args: any[]) => void)(...args);
      } catch (error) {
        this.logger.error(`Error in listener for event "${String(event)}":`, error);
      }
    }

    return true;
  }

  /**
   * Remove listeners. When `event` is provided only that event's listeners
   * are removed; otherwise every listener for every event is cleared.
   */
  removeAllListeners<E extends keyof Events>(event?: E): this {
    if (event === undefined) {
      this.listeners.clear();
      this.warnedEvents.clear();
    } else {
      this.listeners.delete(event);
      this.warnedEvents.delete(event);
    }
    return this;
  }

  /** Number of listeners currently registered for the given event. */
  listenerCount<E extends keyof Events>(event: E): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/**
 * Status of a single ledger entry as reported by {@link queryLedgerTTL}.
 *
 * - `live`: the RPC confirmed the entry exists and is not archived.
 * - `archived`: the RPC confirmed the entry is absent/archived.
 * - `unknown`: the request for this entry failed, so its status could not
 *   be determined. Unknown entries must never be treated as archived.
 */
export type TTLQueryStatus = 'live' | 'archived' | 'unknown';

/**
 * A single entry returned by {@link queryLedgerTTL}.
 */
export interface TTLQueryEntry {
  /** The ledger key this entry describes. */
  key: xdr.LedgerKey;
  /** Whether the entry is live, archived, or of unknown status. */
  status: TTLQueryStatus;
  /**
   * Convenience flag mirroring `status === 'archived'`. Entries whose status
   * is `unknown` are never reported as archived.
   */
  isArchived: boolean;
  /** Remaining TTL in ledgers, when known. */
  ttl?: number;
  /** Ledger sequence at which the entry expires, when available. */
  liveUntilLedgerSeq?: number;
  /** Ledger sequence at which the entry was last modified, when available. */
  lastModifiedLedgerSeq?: number;
}

/** Describes a chunk of keys whose `getLedgerEntries` request failed. */
export interface TTLQueryError {
  chunkIndex: number;
  message: string;
}

export type TTLQueryChunkError = TTLQueryError;

/**
 * Result of {@link queryLedgerTTL}.
 *
 * `failedChunks` exposes which chunks failed and why so callers can
 * distinguish a confirmed-absent entry from one whose status is unknown.
 */
export interface TTLQueryResult {
  /** Per-key status, in the same order as the requested keys. */
  entries: TTLQueryEntry[];
  /** Chunks whose request failed, with the underlying error. */
  failedChunks: TTLQueryError[];
  /** Backwards-compatible alias for `failedChunks`. */
  errors: TTLQueryError[];
  /** Convenience flag: true when at least one chunk failed. */
  hasErrors: boolean;
}

/**
 * A single entry in the SDK transaction history.
 */
export interface TransactionHistoryEntry {
  /**
   * Unique identifier for this history entry.
   *
   * When `crypto.randomUUID` is available this is a UUID v4. On older
   * runtimes that lack it, a collision-resistant fallback of the form
   * `<timestamp>-<random>` is used instead. Both formats are opaque
   * strings and are accepted by {@link loadJSON} on hydration.
   */
  id: string;
  /** The transaction hash this entry refers to. */
  hash: string;
  /** The ledger the transaction was included in, when known. */
  ledger?: number;
  /** Unix timestamp (ms) at which the entry was recorded. */
  timestamp: number;
  /** Arbitrary caller-supplied metadata attached to the entry. */
  metadata?: Record<string, unknown>;
}

/**
 * Generate a unique id for a {@link TransactionHistoryEntry}.
 *
 * Prefers `crypto.randomUUID()` (UUID v4) when the runtime exposes it.
 * Falls back to a timestamp + random suffix for older runtimes; the
 * fallback is documented on {@link TransactionHistoryEntry.id} and is
 * still accepted by {@link loadJSON} on hydration.
 */
export function generateId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export type { ResurrectErrorCode } from './errors.js';

/** State labels published by the SDK during recovery and TTL workflows. */
export type RestoreState =
  | 'idle'
  | 'simulating'
  | 'restore_needed'
  | 'signing_restore'
  | 'submitting_restore'
  | 'confirming_restore'
  | 'signing_original'
  | 'submitting_original'
  | 'estimating'
  | 'watching_ttl'
  | 'extending_ttl'
  | 'success'
  | 'error';

/** Ledger key data needed for restore workflows; never includes signer secrets. */
export interface ArchivedLedgerEntry {
  /** Stellar SDK XDR ledger key used when building a restore footprint. */
  key: xdr.LedgerKey;
  /** Base64 XDR representation suitable for serialization. */
  keyBase64: XdrBase64;
  /** Stable public ledger-entry classification. */
  entryType?: 'contractData' | 'contractCode' | 'other';
  /** Expiration metadata, when available from a successful ledger query. */
  liveUntilLedger?: number;
  currentLedger?: number;
  ttlLedgers?: number;
}

/** The wallet operations required by the SDK's transaction workflows. */
export interface WalletAdapter {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  signTransaction(
    transactionXdr: XdrBase64 | string,
    options?: { networkPassphrase?: string; network?: string },
  ): Promise<XdrBase64 | string>;
  getNetwork?(): Promise<string>;
  signAuthEntry?(
    authEntryXdr: XdrBase64,
    options?: { networkPassphrase?: string; address?: string },
  ): Promise<XdrBase64>;
  readonly capabilities?: WalletCapabilities;
}

/** Optional wallet capability declarations consumed by SDK workflows. */
export interface WalletCapabilities {
  signTransaction?: boolean;
  signAuthEntry?: boolean;
  feeBump?: boolean;
  hardware?: boolean;
  blindSigning?: boolean;
  multiAccount?: boolean;
}

export type WalletErrorCode =
  | 'USER_REJECTED'
  | 'NETWORK_MISMATCH'
  | 'NOT_CONNECTED'
  | 'UNSUPPORTED_CAPABILITY'
  | 'SIGNING_FAILED'
  | 'UNKNOWN';

/** Wallet failure carrying a stable code for caller-side handling. */
export class WalletError extends Error {
  constructor(
    readonly code: WalletErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

/** Full SDK configuration; all optional values receive defaults at construction. */
export interface SorobanResurrectConfig {
  rpcUrl: string;
  networkPassphrase?: string;
  rpcClient?: ISorobanRpcClient;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Maximum time to wait for the initial transaction simulation. */
  simulationTimeoutMs?: number;
  /** Maximum time to wait for wallet transaction signing. */
  walletSigningTimeoutMs?: number;
  /** Maximum time to wait for a restore transaction to be confirmed. */
  restoreConfirmationTimeoutMs?: number;
  /** Maximum time to wait for submission of the original transaction. */
  originalSubmissionTimeoutMs?: number;
  restoreFeeMultiplier?: number;
  maxRestoreFeeStroops?: number | string;
  maxSequenceRetries?: number;
  archiveDetectionMethod?: 'simulation' | 'direct';
  archiveDetectionFallback?: boolean;
  archiveDetectionChunkSize?: number;
  archiveDetectionConcurrency?: number;
  restoreSizeWarnRatio?: number;
  maxRestoreTxSizeBytes?: number;
  throwOnRestoreSizeLimit?: boolean;
  rpcTimeoutMs?: number;
  rpcRetryCount?: number;
  rpcRetryBackoffMs?: number;
  rpcCircuitBreakerThreshold?: number;
  rpcCircuitBreakerCooldownMs?: number;
  ttlWatchIntervalMs?: number;
  ttlWatchThreshold?: number;
  ttlWatchThresholdLedgers?: number;
  ttlWatchAutoExtend?: boolean;
  restoreTxMemo?: Memo;
  restoreTxMemoText?: string;
  useSSE?: boolean;
  enableSimulationCache?: boolean;
  simulationCacheTtlMs?: number;
  simulationCacheMaxSize?: number;
  logger?: Logger;
}

/** Options for direct archived-key detection. */
export interface ArchiveDetectionOptions {
  chunkSize?: number;
  concurrency?: number;
}

/** Simulation response returned by Soroban RPC. */
export type SimulateResponse = import('@stellar/stellar-sdk').rpc.Api.SimulateTransactionResponse;

/** Result of a recovery submission or direct restore. */
export interface ResurrectResult {
  success: boolean;
  archivedKeysDetected: number;
  restoreTxHash?: string;
  originalTxHash?: string;
  error?: string;
  errorCode?: ResurrectErrorCode | WalletErrorCode;
  historyId?: string;
  sequenceRetries?: number;
  diagnostics?: TxDiagnostics;
  onchainError?: import('./TransactionFailure.js').OnchainError;
  dryRun?: boolean;
  dryRunResult?: DryRunResult;
}

/** Structured status snapshot emitted to workflow observers. */
export interface RestoreStateInfo {
  state: RestoreState;
  message: string;
  archivedKeys: ArchivedLedgerEntry[];
  error?: string;
}

/** Dry-run preview returned without wallet calls or transaction submission. */
export interface DryRunResult {
  wouldNeedRestore: boolean;
  archivedKeys: ArchivedLedgerEntry[];
  estimatedRestoreFee: string;
  simulationError?: string;
}

/** Parsed diagnostics from a failed transaction response. */
export interface TxDiagnostics {
  events: string[];
  failedOpIndex?: number;
  revertReason?: string;
  resultCodes?: string[];
  rawEventsXdr?: string[];
}

/** Callback options shared by arbitrary restore and restore-and-submit calls. */
export interface RestoreKeysOptions {
  onSigningRestore?: () => void;
  onSubmittingRestore?: () => void;
  onRestoreSubmitted?: (hash: string) => void;
  onRestoreConfirmed?: (hash: string) => void;
}

/** Inputs and lifecycle callbacks for an automatic restore-and-submit workflow. */
export interface SubmitWithRestoreOptions extends RestoreKeysOptions {
  transaction: Transaction;
  wallet: WalletAdapter;
  onRestoreNeeded?: (keys: ArchivedLedgerEntry[]) => void;
  onSigningOriginal?: () => void;
  onOriginalSubmitted?: (hash: string) => void;
  onRestoreFailed?: (error: string) => void;
  restoreTxMemo?: Memo;
  restoreTxMemoText?: string;
  feeBumpConfig?: FeeBumpConfig;
  dryRun?: boolean;
}

/** Sponsor interface used for fee-bump transactions. */
export interface FeeBumpSponsor {
  getPublicKey(): Promise<string>;
  signFeeBump(
    feeBumpXdr: XdrBase64,
    options?: { networkPassphrase?: string; network?: string },
  ): Promise<XdrBase64 | string>;
}

/** Fee-bump submission settings. */
export interface FeeBumpConfig {
  sponsor: FeeBumpSponsor;
  feeBumpFee?: string;
}

/** Storage interface used by optional durable transaction history. */
export interface HistoryStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

/** Configuration for persisting transaction history. */
export interface HistoryPersistenceOptions {
  storage: HistoryStorage;
  key?: string;
  mode?: 'full' | 'minimal';
  serializer?: {
    serialize(plain: string): string | Promise<string>;
    deserialize(stored: string): string | Promise<string>;
  };
}

/** Hardware-wallet adapter contract. */
export interface HardwareWalletAdapter extends WalletAdapter {
  readonly type: 'ledger' | 'trezor';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface LedgerAdapterConfig {
  transport?: unknown;
  accountIndex?: number;
}

export interface TrezorAdapterConfig {
  manifest?: Record<string, unknown>;
  trezorConnect?: unknown;
  accountIndex?: number;
}

/** Log severity accepted by SDK logging integrations. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured context attached to SDK log calls. */
export interface LogContext {
  requestId?: string;
  method?: string;
  durationMs?: number;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** Timing record for an individual RPC request. */
export interface RpcTimingEvent {
  method: string;
  durationMs: number;
  ok: boolean;
  requestId?: string;
  error?: string;
}

/** Typed event payloads published by the SDK. */
export interface SorobanResurrectEvents {
  stateChange: (info: RestoreStateInfo) => void;
  restoreNeeded: (keys: ArchivedLedgerEntry[]) => void;
  restoreSubmitted: (hash: string) => void;
  restoreConfirmed: (hash: string) => void;
  originalSubmitted: (hash: string) => void;
  restoreComplete: (result: ResurrectResult) => void;
  error: (message: string) => void;
  networkChanged: (event: {
    previous: { rpcUrl: string; networkPassphrase: string };
    current: { rpcUrl: string; networkPassphrase: string };
  }) => void;
  ttlLow: (entries: import('./TTLHelpers.js').LedgerEntryTTLInfo[]) => void;
  ttlExtended: (event: {
    restoreTxHash: string;
    entries: import('./TTLHelpers.js').LedgerEntryTTLInfo[];
  }) => void;
}
