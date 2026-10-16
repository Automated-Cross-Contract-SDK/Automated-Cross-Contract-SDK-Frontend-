import { Transaction, xdr, Memo } from '@stellar/stellar-sdk'
import { rpc } from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from './RpcClient.js'
import type {
  TxHash,
  XdrBase64,
  ContractIdHex,
  HexString,
  StellarPublicKey,
  NetworkPassphrase,
  RpcUrl,
  FeeStroops,
  SequenceNumber,
  HistoryEntryId,
} from './branded-types.js'
import type { ResurrectErrorCode } from './errors.js'
import type {
  HistoryPersistenceMode,
  HistorySerializer,
} from './HistoryPersistence.js'

export type {
  TxHash,
  XdrBase64,
  ContractIdHex,
  HexString,
  StellarPublicKey,
  NetworkPassphrase,
  RpcUrl,
  FeeStroops,
  SequenceNumber,
  HistoryEntryId,
}
export type { OnchainError } from './TransactionFailure.js'
export type { ResurrectErrorCode } from './errors.js'

/**
 * Configuration options for creating a SorobanResurrect instance.
 *
 * @see {@link SorobanResurrect} — the class this config is passed to.
 *
 * @example
 * ```ts
 * const config: SorobanResurrectConfig = {
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: Networks.TESTNET,
 * }
 * ```
 */
export interface SorobanResurrectConfig {
  /** URL of the Soroban RPC endpoint. */
  rpcUrl: RpcUrl | string
  /** Network passphrase (defaults to Testnet). */
  networkPassphrase?: NetworkPassphrase | string
  /** Polling interval in ms when waiting for transaction confirmation. */
  pollIntervalMs?: number
  /** Timeout in ms when waiting for transaction confirmation. */
  pollTimeoutMs?: number
  /**
   * Multiplier applied to minResourceFee when building a restore transaction.
   * Defaults to 3 (3x the base fee). Use higher values (e.g. 5) if restore tx
   * fails to include during congestion, or lower values (e.g. 2) for lower fees.
   * Must be >= 1.
   */
  restoreFeeMultiplier?: number
  /** Method for detecting archived keys: 'simulation' (default) or 'direct'. */
  archiveDetectionMethod?: 'simulation' | 'direct'
  /**
   * Ledger keys per `getLedgerEntries` request during 'direct' archive
   * detection (default: 50). Lower it if the RPC endpoint rejects large
   * batches.
   */
  archiveDetectionChunkSize?: number
  /**
   * Number of `getLedgerEntries` requests kept in flight at once during
   * 'direct' archive detection (default: 4). Raise it for faster detection on
   * large footprints, lower it to stay under a rate limit.
   */
  archiveDetectionConcurrency?: number
  /** Enable simulation cache to reuse results and reduce RPC calls (default: false). */
  enableSimulationCache?: boolean
  /** Use SSE-based transaction status waiting when available (default: false). */
  useSSE?: boolean
  /** Per-call timeout in ms for RPC calls made through the resilient transport (default: 10000). */
  rpcTimeoutMs?: number
  /** Number of retries (beyond the initial attempt) for transient RPC failures (default: 2). */
  rpcRetryCount?: number
  /** Base backoff in ms between RPC retries; doubles each attempt with jitter (default: 250). */
  rpcRetryBackoffMs?: number
  /** Consecutive RPC failures before the circuit breaker trips and fails fast (default: 5). */
  rpcCircuitBreakerThreshold?: number
  /** Cooldown in ms the circuit breaker stays open before allowing calls through again (default: 30000). */
  rpcCircuitBreakerCooldownMs?: number
  /**
   * Default polling cadence (ms) for `watchTTL()` when a call doesn't
   * override it via `TTLWatchOptions.intervalMs`. Defaults to 60_000 (1 min).
   */
  ttlWatchIntervalMs?: number
  /**
   * Default "expiring soon" threshold (in remaining ledgers) for
   * `watchTTL()` when a call doesn't override it via
   * `TTLWatchOptions.thresholdLedgers`. Defaults to 17_280 (~24h at 5s/ledger).
   */
  ttlWatchThreshold?: number
  /**
   * Default for whether `watchTTL()` automatically submits a restore
   * transaction when an entry crosses the threshold, when a call doesn't
   * override it via `TTLWatchOptions.autoExtend`. Defaults to `false`
   * (observe-only — the caller decides what to do with `ttlLow`).
   */
  ttlWatchAutoExtend?: boolean
  /**
   * Optional memo attached to restore transactions built by the SDK.
   *
   * Restore transactions are otherwise built with no memo, so wallets and
   * explorers show a bare `restoreFootprint` operation with no indication of
   * why the signature is being requested. Setting a memo here makes the
   * prompt self-explanatory (e.g. `Memo.text('Soroban archive restore')`).
   *
   * Default: `undefined` (no memo — unchanged behaviour for existing users).
   *
   * @see {@link restoreTxMemoText} for a plain-string convenience form.
   */
  restoreTxMemo?: Memo
  /**
   * Convenience string form of {@link restoreTxMemo}. When set (and
   * `restoreTxMemo` is not), a `Memo.text(restoreTxMemoText)` is attached to
   * restore transactions. Ignored when {@link restoreTxMemo} is provided.
   */
  restoreTxMemoText?: string
  /**
   * Maximum number of times to rebuild and resubmit the original transaction
   * after a `tx_bad_seq` rejection, each attempt fetching a fresh sequence
   * number. Defaults to 3. Only `tx_bad_seq` triggers a retry; every other
   * submission error is surfaced immediately, unchanged.
   */
  /**
   * Optional pre-built RPC client to use instead of creating one from `rpcUrl`.
   *
   * When provided, the SDK uses this client for all Soroban RPC calls
   * instead of instantiating a new `rpc.Server`. This enables:
   * - Injecting test doubles that implement {@link ISorobanRpcClient}
   * - Wrapping the default client with caching, logging, or rate-limiting
   * - Reusing a single client across multiple `SorobanResurrect` instances
   *
   * If omitted, the SDK creates a {@link SorobanRpcClient} from `rpcUrl`
   * automatically (the default behaviour, unchanged from previous versions).
   *
   * @example
   * ```ts
   * import { createRpcClient } from '@soroban-resurrect/sdk'
   *
   * const client = createRpcClient('https://soroban-testnet.stellar.org')
   * const sdk = new SorobanResurrect({ rpcUrl: '...', rpcClient: client })
   * ```
   */
  rpcClient?: ISorobanRpcClient
  /**
   * Maximum acceptable fee (in stroops) for a restore transaction. When set,
   * `buildRestoreTransaction` throws a {@link RestoreFeeCapExceededError} if
   * `minResourceFee * restoreFeeMultiplier` would exceed this cap, instead of
   * silently signing an unexpectedly expensive transaction.
   */
  maxRestoreFeeStroops?: FeeStroops | string
  /**
   * Maximum number of times the restore workflow will rebuild the original
   * transaction (with a fresh sequence number) and resubmit it after a
   * `tx_bad_seq` submission error. Defaults to 3. Only `tx_bad_seq` triggers
   * a retry — all other submission errors are surfaced immediately.
   */
  maxSequenceRetries?: number
}

/**
 * Feature-detection flags a {@link WalletAdapter} may advertise so the SDK can
 * pick the right code path instead of guessing (and relying on try/catch).
 *
 * All flags are optional. A missing flag means "unknown" — the SDK falls back to
 * its previous best-effort behaviour (attempt the operation and handle failure).
 * An explicit `false` lets the SDK fail fast with a clear error before prompting
 * the user's wallet.
 *
 * @see {@link WalletAdapter.capabilities}
 */
export interface WalletCapabilities {
  /**
   * The wallet can sign individual Soroban authorization entries
   * (CAP-0046 fine-grained authorization) via a `signAuthEntry` method.
   */
  signAuthEntry?: boolean
  /**
   * The wallet can sign fee-bump transaction envelopes (`ENVELOPE_TYPE_TX_FEE_BUMP`).
   */
  feeBump?: boolean
  /**
   * The wallet is backed by a hardware device (Ledger, Trezor, …). Signing may
   * be slow and requires physical confirmation; blind-signing limits may apply.
   */
  hardware?: boolean
  /**
   * Maximum number of operations the wallet will sign in a single transaction,
   * if the wallet imposes such a limit. Omit when there is no known limit.
   */
  maxOperations?: number
}

/**
 * Wallet interface that wraps browser or extension wallets (e.g. Freighter).
 *
 * @see {@link SubmitWithRestoreOptions.wallet}
 *
 * @example
 * ```ts
 * const wallet: WalletAdapter = {
 *   isConnected: async () => freighter.isConnected(),
 *   getPublicKey: async () => (await freighter.getAddress()).address,
 *   signTransaction: (xdr, opts) => freighter.signTransaction(xdr, opts),
 *   capabilities: { signAuthEntry: true, feeBump: true, hardware: false },
 * }
 * ```
 */
export interface WalletAdapter {
  /** Returns whether the wallet is connected. */
  isConnected(): Promise<boolean>
  /** Returns the connected wallet's public key. */
  getPublicKey(): Promise<StellarPublicKey>
  /** Requests the wallet to sign a transaction XDR string. */
  signTransaction(
    tx: XdrBase64,
    opts?: { networkPassphrase?: NetworkPassphrase | string; network?: string },
  ): Promise<XdrBase64>
  /**
   * Optional feature-detection flags. When present, the SDK uses them to choose
   * between the CAP-0046 auth-entry path, the fee-bump path, and their
   * fallbacks — instead of attempting the operation and catching failures.
   *
   * @see {@link WalletCapabilities}
   */
  capabilities?: WalletCapabilities
  /** Returns the wallet network passphrase when the wallet exposes it. */
  getNetwork?(): Promise<string>
}

/** Storage surface accepted by transaction-history persistence. */
export interface HistoryStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem?(key: string): void | Promise<void>
}

/** Options for persisting transaction history alongside the SDK instance. */
export interface HistoryPersistenceOptions {
  storage: HistoryStorage
  key?: string
  mode?: HistoryPersistenceMode
  serializer?: HistorySerializer
}

/** Logging severity accepted by the SDK's observability API. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Structured context passed to logger methods. */
export type LogContext = Record<string, unknown>

/** Timing information emitted for an RPC request. */
export interface RpcTimingEvent {
  method: string
  durationMs: number
  ok: boolean
  requestId?: string
  error?: string
}

export type WalletErrorCode = 'USER_REJECTED' | 'NOT_CONNECTED' | 'NETWORK_MISMATCH' | 'UNKNOWN'

/** Normalized error raised by wallet adapters. */
export class WalletError extends Error {
  readonly code: WalletErrorCode
  readonly originalError: unknown

  constructor(code: WalletErrorCode, message: string, originalError?: unknown) {
    super(message)
    this.name = 'WalletError'
    this.code = code
    this.originalError = originalError
  }
}

/**
 * Sponsor interface for fee-bump transactions.
 * A fee-bump sponsor pays the transaction fees on behalf of the user
 * by wrapping the inner (user-signed) transaction in a fee-bump envelope.
 */
export interface FeeBumpSponsor {
  /** Returns the sponsor's public key (the account that pays the fee). */
  getPublicKey(): Promise<StellarPublicKey>
  /**
   * Signs a fee-bump transaction XDR string.
   * The provided XDR is a fully constructed FeeBumpTransaction envelope
   * wrapping the user-signed inner transaction.
   */
  signFeeBump(
    txXdr: XdrBase64,
    opts?: { networkPassphrase?: NetworkPassphrase | string },
  ): Promise<XdrBase64>
}

/**
 * Configuration for fee-bump transactions.
 * When provided, the restore and/or original transactions will be wrapped
 * in fee-bump envelopes so the sponsor pays the fees.
 */
export interface FeeBumpConfig {
  /** The fee-bump sponsor who will sign and pay the fees. */
  sponsor: FeeBumpSponsor
  /**
   * Optional custom fee for the fee-bump wrapper (in stroops).
   * If not provided, defaults to the inner transaction's fee.
   */
  feeBumpFee?: FeeStroops | string
}

/**
 * Tuning options for chunked, parallel archive detection.
 *
 * @see {@link SorobanResurrectConfig.archiveDetectionChunkSize}
 * @see {@link SorobanResurrectConfig.archiveDetectionConcurrency}
 */
export interface ArchiveDetectionOptions {
  /** Ledger keys per `getLedgerEntries` request (default 50). */
  chunkSize?: number
  /** Requests issued in parallel (default 4). */
  concurrency?: number
}

/** Represents a single ledger entry that has been archived (expired TTL). */
export interface ArchivedLedgerEntry {
  /** The raw ledger key. */
  key: xdr.LedgerKey
  /** Base64-encoded XDR string representation of the ledger key. */
  keyBase64: XdrBase64
}

/** Convenience alias for the Soroban RPC simulate response type. */
export type SimulateResponse = rpc.Api.SimulateTransactionResponse

/**
 * Parsed on-chain diagnostics for a failed transaction.
 *
 * Populated on {@link ResurrectResult.diagnostics} when `waitForTransaction`
 * reports `FAILED` for either the restore transaction or the original
 * transaction. Absent entirely on success so the success result shape stays
 * lean.
 */
export interface TxDiagnostics {
  /**
   * Human-readable summaries of the `DiagnosticEvent`s attached to the failed
   * transaction, in on-chain order. Empty when the RPC returned no diagnostic
   * events (e.g. classic pre-flight failures).
   */
  events: string[]
  /**
   * Zero-based index of the operation that failed, when derivable from the
   * transaction result XDR.
   */
  failedOpIndex?: number
  /**
   * Best-effort decoded revert / panic / error message extracted from the
   * diagnostic events, when one is present and decodable.
   */
  revertReason?: string
  /**
   * Transaction- and operation-level result codes from the result XDR
   * (e.g. `txFailed`, `invokeHostFunctionTrapped`).
   */
  resultCodes?: string[]
  /**
   * Raw base64-encoded `DiagnosticEvent` XDR strings, for callers that want to
   * decode them with their own tooling.
   */
  rawEventsXdr?: string[]
}

/**
 * Result returned from the restore-and-submit workflow.
 *
 * @see {@link SorobanResurrect.submitWithRestore}
 */
export interface ResurrectResult {
  /** Whether the full transaction lifecycle succeeded. */
  success: boolean
  /** Hash of the submitted original transaction (present on success). */
  originalTxHash?: TxHash
  /** Hash of the submitted restore transaction (present if restore was needed). */
  restoreTxHash?: TxHash
  /** Number of archived ledger entries that were detected and restored. */
  archivedKeysDetected: number
  /** Error message if the workflow failed. */
  error?: string
  /**
   * Machine-readable error code for programmatic branching (present when
   * `success` is `false`). Follows a GraphQL-like `extensions.code` pattern
   * so consumers can switch on codes instead of parsing strings.
   *
   * @example
   * ```ts
   * if (!result.success) {
   *   switch (result.errorCode) {
   *     case 'WALLET_NOT_CONNECTED': promptConnect(); break
   *     case 'RESTORE_TX_FAILED':   showRestoreError(); break
   *     default:                    showGenericError(result.error)
   *   }
   * }
   * ```
   */
  errorCode?: ResurrectErrorCode
  /** True when the result came from a dry-run (no transactions submitted). */
  dryRun?: boolean
  /** Detailed dry-run information (present when dryRun is true). */
  dryRunResult?: DryRunResult
  /**
   * History entry id for this attempt. Present when the result was produced
   * by `SorobanResurrect.submitWithRestore`. Pass to `retry()` to re-attempt
   * the workflow without rebuilding the original transaction.
   */
  historyId?: string
  /**
   * Number of `tx_bad_seq` rebuild-and-resubmit retries performed for the
   * original transaction. Only present when a restore occurred; `0` means
   * the original transaction was accepted on the first attempt.
   */
  sequenceRetries?: number
}

/** Options for {@link SorobanResurrect.restoreKeys}. */
export interface RestoreKeysOptions {
  /** Called when the wallet is prompted to sign the restore transaction. */
  onSigningRestore?: () => void
  /** Called right before the restore transaction is submitted. */
  onSubmittingRestore?: () => void
  /** Called after the restore transaction is submitted. */
  onRestoreSubmitted?: (txHash: TxHash) => void
  /** Called after the restore transaction is confirmed on-chain. */
  onRestoreConfirmed?: (txHash: TxHash) => void
}

/**
 * Detailed result of a dry-run simulation.
 *
 * Contains all information that would be needed to decide whether to
 * proceed with the real submission — without having signed or submitted
 * anything to the network.
 */
export interface DryRunResult {
  /** Whether the transaction would require a restore before submission. */
  wouldNeedRestore: boolean
  /** Number of archived ledger entries detected. */
  archivedKeysDetected: number
  /** The archived ledger entries that would need to be restored. */
  archivedKeys: ArchivedLedgerEntry[]
  /** Estimated restore transaction fee (in stroops, as a string). Present when restore is needed. */
  estimatedRestoreFee?: FeeStroops
  /** Simulation error message, if simulation itself failed. */
  simulationError?: string
}

/** Options for submitting a transaction with automatic archive restoration. */
export interface SubmitWithRestoreOptions {
  /** The Soroban transaction to submit. */
  transaction: Transaction
  /** Wallet adapter used for signing. */
  wallet: WalletAdapter
  /**
   * Optional fee-bump configuration. When provided, transactions are wrapped
   * in fee-bump envelopes so the sponsor pays fees on behalf of the user.
   */
  feeBumpConfig?: FeeBumpConfig
  /** Called when restore transaction is ready to be signed. */
  onSigningRestore?: () => void
  /** Called after restore transaction is signed and being submitted. */
  onSubmittingRestore?: () => void
  /** Called after restore transaction is confirmed and original is ready to sign. */
  onSigningOriginal?: () => void
  /** Called when archived entries are detected and restoration is required. */
  onRestoreNeeded?: (archivedKeys: ArchivedLedgerEntry[]) => void
  /** Called after the restore transaction is submitted. */
  onRestoreSubmitted?: (txHash: TxHash) => void
  /** Called after the restore transaction is confirmed on-chain. */
  onRestoreConfirmed?: (txHash: TxHash) => void
  /** Called after the original transaction is submitted. */
  onOriginalSubmitted?: (txHash: TxHash) => void
  /** Called when the restore step of the workflow fails. */
  onRestoreFailed?: (error: string) => void
  /**
   * Per-call override for {@link SorobanResurrectConfig.restoreTxMemo}.
   * Takes precedence over the instance config for this workflow only.
   */
  restoreTxMemo?: Memo
  /**
   * Per-call override for {@link SorobanResurrectConfig.restoreTxMemoText}.
   * Ignored when {@link restoreTxMemo} is provided.
   */
  restoreTxMemoText?: string
}

/**
 * Tracks the current stage of the restore-and-submit workflow.
 *
 * See {@link SorobanResurrect.onStateChange} for how to subscribe to
 * transitions between these states, and `ARCHITECTURE.md` in the repo
 * root for the full state diagram.
 *
 * The union is **additive** — the original reactive submit-flow states
 * (`idle` → `simulating` → `restore_needed` → ... → `success` / `error`)
 * are unchanged. Three extra states model long-running, non-submit
 * activity that does not fit the submit flow:
 *
 * - `estimating` — a fee / resource estimation pass is running.
 * - `watching_ttl` — a proactive TTL watcher is polling entry lifetimes.
 * - `extending_ttl` — a `RestoreFootprint`/`ExtendFootprintTTL` bump is
 *   being signed and submitted proactively (before archival).
 */
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
  // --- Proactive / estimation states (additive, non-submit) ---
  | 'estimating'
  | 'watching_ttl'
  | 'extending_ttl'

/** Snapshot of the current workflow state, including message and optional error. */
export interface RestoreStateInfo {
  /** Current workflow stage. */
  state: RestoreState
  /** Human-readable status message. */
  message: string
  /** Archived keys detected (only set in restore_needed and later states). */
  archivedKeys?: ArchivedLedgerEntry[]
  /** Error message (only set in error state). */
  error?: string
}

/**
 * Typed events emitted by SorobanResurrect for specific workflow transitions,
 * in addition to the general-purpose `onStateChange` observer.
 */
export interface SorobanResurrectEvents {
  /** Fired on every state transition (mirrors `onStateChange`). */
  stateChange: RestoreStateInfo
  /** Fired when archived entries are detected and restoration is required. */
  restoreNeeded: ArchivedLedgerEntry[]
  /** Fired after the restore transaction is submitted, with its tx hash. */
  restoreSubmitted: TxHash
  /** Fired after the restore transaction is confirmed on-chain, with its tx hash. */
  restoreConfirmed: TxHash
  /** Fired after the original transaction is submitted, with its tx hash. */
  originalSubmitted: TxHash
  /** Fired once the full restore-and-submit workflow finishes, with the result. */
  restoreComplete: ResurrectResult
  /** Fired when the workflow fails, with the error message. */
  error: string
  /** Fired after `switchNetwork()` re-binds the RPC client and network passphrase. */
  networkChanged: { rpcUrl: string; networkPassphrase: string }
}

// ---------------------------------------------------------------------------
// Hardware wallet types (used by HardwareWalletAdapters.ts)
// ---------------------------------------------------------------------------

/**
 * Extended wallet adapter interface for hardware wallets that support
 * explicit connect/disconnect lifecycle methods.
 */
export interface HardwareWalletAdapter extends WalletAdapter {
  /** The hardware wallet type identifier. */
  readonly type: 'ledger' | 'trezor'
  /** Opens a connection to the hardware device. */
  connect(): Promise<void>
  /** Closes the connection to the hardware device. */
  disconnect(): Promise<void>
  /** Returns the firmware/app version string from the device. */
  getAppVersion(): Promise<string>
}

/**
 * Configuration for the Ledger hardware wallet adapter.
 */
export interface LedgerAdapterConfig {
  /**
   * A Ledger transport instance (e.g. from `@ledgerhq/hw-transport-webusb`).
   * If omitted, `connect()` will throw with instructions.
   */
  transport?: unknown
  /**
   * BIP44 account index for key derivation (default: 0).
   * Path: `m/44'/148'/accountIndex'`
   */
  accountIndex?: number
}

/**
 * Configuration for the Trezor hardware wallet adapter.
 */
export interface TrezorAdapterConfig {
  /**
   * A TrezorConnect instance (e.g. from `@trezor/connect-web`).
   * Required for connecting to the device.
   */
  trezorConnect: unknown
  /**
   * App manifest required by TrezorConnect for permission purposes.
   */
  manifest: {
    email: string
    appUrl: string
  }
  /**
   * BIP44 account index for key derivation (default: 0).
   * Path: `m/44'/148'/accountIndex'/0/0`
   */
  accountIndex?: number
}
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
        this.logger.error(
          `Error in listener for event "${String(event)}":`,
          error,
        );
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
  key: string;
  /** Whether the entry is live, archived, or of unknown status. */
  status: TTLQueryStatus;
  /**
   * Convenience flag mirroring `status === 'archived'`. Entries whose status
   * is `unknown` are never reported as archived.
   */
  isArchived: boolean;
  /** Remaining TTL in ledgers, when known. */
  ttl?: number;
}

/**
 * Describes a chunk of keys whose `getLedgerEntries` request failed.
 */
export interface TTLQueryChunkError {
  /** Index of the failing chunk within the original request. */
  chunkIndex: number;
  /** The keys that were part of the failing chunk. */
  keys: string[];
  /** The error thrown by the underlying RPC call. */
  error: unknown;
}

/**
 * Result of {@link queryLedgerTTL}.
 *
 * `failedChunks` exposes which chunks failed and why so callers can
 * distinguish a confirmed-absent entry from one whose status is unknown.
 */
export interface TTLQueryResult {
  /** Per-key status, keyed by the requested ledger key. */
  entries: Record<string, TTLQueryEntry>;
  /** Chunks whose request failed, with the underlying error. */
  failedChunks: TTLQueryChunkError[];
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
