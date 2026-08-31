import { Transaction, xdr } from '@stellar/stellar-sdk'
import { rpc } from '@stellar/stellar-sdk'
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
}

/**
 * Tracks the current stage of the restore-and-submit workflow.
 *
 * See {@link SorobanResurrect.onStateChange} for how to subscribe to
 * transitions between these states, and `ARCHITECTURE.md` in the repo
 * root for the full state diagram.
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

// ---------------------------------------------------------------------------
// Hardware wallet types
// ---------------------------------------------------------------------------

/**
 * Extended wallet adapter interface for hardware wallet devices (Ledger, Trezor).
 * Adds `connect`/`disconnect` lifecycle methods to the base `WalletAdapter`.
 */
export interface HardwareWalletAdapter extends WalletAdapter {
  /** Device type identifier. */
  readonly type: 'ledger' | 'trezor'
  /** Connects to the hardware device and prepares it for signing. */
  connect(): Promise<void>
  /** Disconnects from the hardware device and releases the transport. */
  disconnect(): Promise<void>
}

/**
 * Configuration for `LedgerWalletAdapter`.
 *
 * @see {@link LedgerWalletAdapter}
 */
export interface LedgerAdapterConfig {
  /**
   * A pre-opened Ledger transport instance (e.g. from `@ledgerhq/hw-transport-webusb`).
   * When omitted, the adapter cannot sign — you must call `connect()` manually after
   * supplying a transport via `setTransport()`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transport?: any
  /** BIP44 account index for key derivation (default: 0). */
  accountIndex?: number
}

/**
 * Configuration for `TrezorWalletAdapter`.
 *
 * @see {@link TrezorWalletAdapter}
 */
export interface TrezorAdapterConfig {
  /**
   * Your application's manifest — required by Trezor Connect.
   * See https://connect.trezor.io/9/methods/manifest/
   */
  manifest: {
    /** Email address for the application maintainer. */
    email: string
    /** URL of the application's public repository. */
    appUrl: string
  }
  /** BIP44 account index for key derivation (default: 0). */
  accountIndex?: number
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
