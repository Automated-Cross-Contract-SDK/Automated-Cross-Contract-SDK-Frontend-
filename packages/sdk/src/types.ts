import type { Memo, Transaction, xdr } from '@stellar/stellar-sdk';
import type { rpc } from '@stellar/stellar-sdk';
import type { ISorobanRpcClient } from './RpcClient.js';
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
} from './branded-types.js';

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
};
import type { OnchainError } from './TransactionFailure.js';
import type { ResurrectErrorCode } from './errors.js';
export type { OnchainError, ResurrectErrorCode };

/** Logging sink accepted by `config.logger`. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

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
  /** Optional structured logger; when omitted the SDK is silent. */
  logger?: Logger
  /** Optional durable transaction-history persistence configuration. */
  persistHistory?: HistoryPersistenceOptions
  /** Clock, randomness, and scheduling primitives used by TTL and polling. */
  runtime?: SdkRuntime
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
  /** Simulation cache lifetime in milliseconds. */
  simulationCacheTtlMs?: number
  /** Maximum number of simulation cache entries. */
  simulationCacheMaxSize?: number
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
  /** Default "expiring soon" threshold in ledgers for TTL watchers. */
  ttlWatchThresholdLedgers?: number
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
  /**
   * Framework-neutral metrics hooks for observing SDK lifecycle events.
   * Implement {@link MetricsHook} and pass it here to track success, failure,
   * and recovery outcomes with a compatible metrics system (Datadog, Prometheus,
   * New Relic, etc.) without vendor coupling.
   *
   * All hook callbacks receive only safe metadata: no wallet addresses,
   * private keys, transaction XDR, or other sensitive data.
   *
   * @see {@link MetricsHook} for available callbacks and metadata fields.
   */
  metricsHook?: import('./MetricsHooks.js').MetricsHook

  /** Maximum serialized size in bytes allowed for a restore transaction. */
  maxRestoreTxSizeBytes?: number
  /** Warn once the restore transaction approaches the serialized-size limit. */
  restoreSizeWarnRatio?: number
  /** Throw rather than warn when a restore transaction exceeds its size limit. */
  throwOnRestoreSizeLimit?: boolean
  maxBatchSize?: number
  archiveDetectionFallback?: boolean
  /** Maximum time to wait for the initial transaction simulation. */
  simulationTimeoutMs?: number
  /** Maximum time to wait for wallet transaction signing. */
  walletSigningTimeoutMs?: number
  /** Maximum time to wait for a restore transaction to be confirmed. */
  restoreConfirmationTimeoutMs?: number
  /** Maximum time to wait for submission of the original transaction. */
  originalSubmissionTimeoutMs?: number
}

/**
 * Platform-neutral storage contract for transaction history persistence.
 *
 * Both synchronous Web Storage and asynchronous stores such as React Native
 * AsyncStorage are supported. Storage access should be supplied lazily by the
 * host application when its platform is available.
 */
export interface HistoryStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;

  removeItem?(key: string): void | Promise<void>
}

/** Options for persisting transaction history. */
export interface HistoryPersistenceOptions {
  /** A platform-appropriate key/value storage adapter. */
  storage: HistoryStorage;
  /** Storage key; defaults to `soroban-resurrect:history`. */
  key?: string;
  /** Persist redacted transaction hashes instead of full transaction data. */
  mode?: 'full' | 'minimal';
  /** Optional transform used to encrypt/decrypt or forward stored data. */
  serializer?: {
    serialize(plain: string): string | Promise<string>;
    deserialize(stored: string): string | Promise<string>;
  };
}

/**
 * A logger that discards every message. Used as the default when no
 * logger is injected so the SDK never writes to the console on its own.
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

  signTransaction?: boolean
  blindSigning?: boolean
  multiAccount?: boolean
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

  /** Signs a CAP-0046 authorization entry (base64 XDR) and returns the signed entry. */
  signAuthEntry?(
    authEntryXdr: string,
    options?: { networkPassphrase?: string; address?: string },
  ): Promise<string>
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

  /** Stable public ledger-entry classification. */
  entryType?: 'contractData' | 'contractCode' | 'other'
  /** Expiration metadata, when available from a successful ledger query. */
  liveUntilLedger?: number
  currentLedger?: number
  ttlLedgers?: number
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
  /** Typed lifecycle and safe recovery guidance for a failed attempt. */
  failure?: ResurrectFailure
  /** Decoded on-chain cause when the RPC returned a failed transaction. */
  onchainError?: OnchainError
  /** Original bounds and detection time when an expired rebuild was refused. */
  expiredTransaction?: ExpiredTransactionInfo
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

  diagnostics?: TxDiagnostics
  /** `submitted` does not imply on-chain success or finality. */
  confirmationStatus?: 'confirmed' | 'submitted' | 'pending'
}

/** Lifecycle stage at which a restore workflow can fail. */
export type ResurrectFailureStage =
  | 'simulation'
  | 'restore'
  | 'rebuild'
  | 'signing'
  | 'submission'
  | 'confirmation'
  | 'unknown'

/** Stable, actionable metadata accompanying the readable `error` message. */
export interface ResurrectFailure {
  stage: ResurrectFailureStage
  code: ResurrectErrorCode
  retryable: boolean
  /** Safe user-facing next step, without raw RPC or contract data. */
  nextStep: string
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
  /** Operation type names, in the order they appear in the original transaction. */
  intendedOperations: string[]
  /** Number of archived ledger entries detected. */
  archivedKeysDetected: number
  /** The archived ledger entries that would need to be restored. */
  archivedKeys: ArchivedLedgerEntry[]
  /** Estimated restore transaction fee (in stroops, as a string). Present when restore is needed. */
  estimatedRestoreFee?: FeeStroops
  /** Simulation error message, if simulation itself failed. */
  simulationError?: string
  /** Typed guidance when simulation could not complete. */
  failure?: ResurrectFailure
}

/** Storage contract accepted by transaction-history persistence. */
export interface HistoryStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem?(key: string): void | Promise<void>
}

/** Configuration for persisting transaction history. */
export interface HistoryPersistenceOptions {
  storage: HistoryStorage
  key?: string
  mode?: 'full' | 'minimal'
  serializer?: {
    serialize(plain: string): string | Promise<string>
    deserialize(stored: string): string | Promise<string>
  }
}

/**
 * Absolute Unix-second bounds for the rebuilt transaction.
 *
 * `maxTime` must be in the future when the rebuild is prepared. If omitted
 * from submit options, the SDK preserves the original transaction's bounds.
 */
export interface RebuildTimeBounds {
  minTime?: number
  maxTime: number
}

/**
 * The original finite transaction bounds that expired while a restore was
 * in progress. Times are absolute Unix seconds.
 */
export interface ExpiredTransactionInfo {
  originalTimeBounds: {
    minTime: number
    maxTime: number
  }
  detectedAt: number
}

/** Options for submitting a transaction with automatic archive restoration. */
export interface SubmitWithRestoreOptions {
  /** The Soroban transaction to submit. */
  transaction: Transaction
  /** Wallet adapter used for signing. */
  wallet: WalletAdapter
  /**
   * Simulate and return a preview without signing, submitting, or recording
   * history. Use {@link SorobanResurrect.previewRestore} when no wallet is
   * available.
   */
  dryRun?: boolean
  /**
   * Optional fee-bump configuration. When provided, transactions are wrapped
   * in fee-bump envelopes so the sponsor pays fees on behalf of the user.
   */
  feeBumpConfig?: FeeBumpConfig
  /**
   * Absolute time bounds for the rebuilt transaction. By default the SDK
   * preserves the original transaction's bounds and refuses to extend an
   * expired maximum time. Supply future bounds only when the caller intends
   * to replace the original expiry.
   */
  rebuildTimeBounds?: RebuildTimeBounds
  /**
   * Called only when the original transaction expires during a restore.
   * Return future replacement bounds to explicitly approve rebuilding; return
   * `undefined` (or omit the callback) to stop with `ORIGINAL_TRANSACTION_EXPIRED`.
   */
  approveExpiredRebuild?: (
    expiredTransaction: ExpiredTransactionInfo,
  ) => RebuildTimeBounds | undefined | Promise<RebuildTimeBounds | undefined>
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

  /**
   * Called for each typed workflow phase, including simulation, restore
   * preparation/submission/confirmation, original submission/confirmation,
   * and completion.
   * The same payloads are published through `sdk.on('workflowLifecycle', ...)`.
   */
  onLifecycleEvent?: (event: SubmitLifecycleEvent) => void
  /** Stable logical identifier used to share an in-flight request. */
  requestId?: string
  /** Opt-in retries for transient RPC failures only. */
  retry?: SubmitRetryOptions
  /** Defaults to waiting for a terminal SUCCESS/FAILED RPC status. */
  confirmationPolicy?: ConfirmationPolicy
  /** Per-call override for the confirmation polling timeout. */
  confirmationTimeoutMs?: number
  /** Defaults to returning an error when the confirmation timeout expires. */
  confirmationTimeoutBehavior?: ConfirmationTimeoutBehavior
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

  workflowLifecycle: SubmitLifecycleEvent
  ttlLow: unknown[]
  ttlExtended: { restoreTxHash: TxHash | string; entries: unknown[] }
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

  readonly capabilities: WalletCapabilities
}

/** Confirmation policy for the original transaction. */
export type ConfirmationPolicy = 'wait-for-finality' | 'return-on-submission';

/** Behavior when confirmation polling reaches its timeout. */
export type ConfirmationTimeoutBehavior = 'error' | 'return-pending';

/** Retry policy for transient RPC transport/server failures. */
export interface SubmitRetryOptions {
  /** Retries beyond the initial RPC call. Defaults to 3 when enabled. */
  maxRetries?: number;
  /** Initial backoff in ms. Defaults to 250. */
  baseDelayMs?: number;
  /** Maximum backoff in ms. Defaults to 5000. */
  maxDelayMs?: number;
}

/** Lifecycle phases reported during a submit-with-restore request. */
export type SubmitLifecyclePhase =
  | 'simulation_started'
  | 'restore_preparation_started'
  | 'restore_submission_started'
  | 'restore_submitted'
  | 'restore_confirmation_started'
  | 'restore_confirmed'
  | 'original_submission_started'
  | 'original_submitted'
  | 'original_confirmation_started'
  | 'original_confirmed'
  | 'completed'
  | 'failed';

/** Typed event emitted for a submit-with-restore lifecycle phase. */
export interface SubmitLifecycleEvent {
  phase: SubmitLifecyclePhase;
  requestId?: string;
  transactionHash?: TxHash;
  archivedKeys?: ArchivedLedgerEntry[];
  result?: ResurrectResult;
  error?: string;
}

/** Logger verbosity level. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured context accepted by the SDK logger. */
export interface LogContext extends Record<string, unknown> {
  method?: string;
  durationMs?: number;
  requestId?: string;
  ok?: boolean;
  error?: string;
}

/** Timing information for an RPC call. */
export interface RpcTimingEvent {
  method: string;
  durationMs: number;
  ok: boolean;
  requestId?: string;
  error?: string;
}

/** Configuration for the Ledger adapter. */
export interface LedgerAdapterConfig {
  transport?: unknown;
  accountIndex?: number;
}

/** Configuration for the Trezor adapter. */
export interface TrezorAdapterConfig {
  trezorConnect: unknown;
  manifest: { email: string; appUrl: string };
  accountIndex?: number;
}

/** Injectable wall clock, random source, and timer functions. */
export interface SdkRuntime {
  /** Current time in milliseconds. */
  now(): number
  /** Random value in [0, 1), used to jitter polling delays. */
  random(): number
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof globalThis.setTimeout>
  clearTimeout(timer: ReturnType<typeof globalThis.setTimeout>): void
  setInterval(callback: () => void, intervalMs: number): ReturnType<typeof globalThis.setInterval>
  clearInterval(timer: ReturnType<typeof globalThis.setInterval>): void
}

/** Configuration returned by resolveConfig with core runtime defaults applied. */
export type ResolvedSorobanResurrectConfig = Omit<SorobanResurrectConfig, 'rpcClient'> & {
  networkPassphrase: string
  pollIntervalMs: number
  pollTimeoutMs: number
  restoreFeeMultiplier: number
  archiveDetectionMethod: 'simulation' | 'direct'
  useSSE: boolean
  enableSimulationCache: boolean
  simulationCacheTtlMs: number
  simulationCacheMaxSize: number
  ttlWatchIntervalMs: number
  ttlWatchThreshold: number
  ttlWatchAutoExtend: boolean
  ttlWatchThresholdLedgers: number
  simulationTimeoutMs: number
  walletSigningTimeoutMs: number
  restoreConfirmationTimeoutMs: number
  originalSubmissionTimeoutMs: number
  maxBatchSize: number
  runtime: SdkRuntime
  rpcClient: ISorobanRpcClient
}

/** A {@link ResurrectResult} narrowed to the successful outcome. */
export type ResurrectSuccess = ResurrectResult & { success: true }

/** A {@link ResurrectResult} narrowed to the failed outcome. */
export type ResurrectFailedResult = ResurrectResult & { success: false }
