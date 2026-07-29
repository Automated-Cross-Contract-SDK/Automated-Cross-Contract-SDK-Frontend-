import { Transaction, xdr } from '@stellar/stellar-sdk'
import { rpc } from '@stellar/stellar-sdk'

/** Configuration options for creating a SorobanResurrect instance. */
export interface SorobanResurrectConfig {
  /** URL of the Soroban RPC endpoint. */
  rpcUrl: string
  /** Network passphrase (defaults to Testnet). */
  networkPassphrase?: string
  /** Polling interval in ms when waiting for transaction confirmation. */
  pollIntervalMs?: number
  /** Timeout in ms when waiting for transaction confirmation. */
  pollTimeoutMs?: number
  /** Multiplier applied to minResourceFee when building a restore transaction (defaults to 100). */
  restoreFeeMultiplier?: number
  /** Method for detecting archived keys: 'simulation' (default) or 'direct'. */
  archiveDetectionMethod?: 'simulation' | 'direct'
}

/** Wallet interface that wraps browser or extension wallets (e.g. Freighter). */
export interface WalletAdapter {
  /** Returns whether the wallet is connected. */
  isConnected(): Promise<boolean>
  /** Returns the connected wallet's public key. */
  getPublicKey(): Promise<string>
  /** Requests the wallet to sign a transaction XDR string. */
  signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string>
}

/**
 * Extended wallet interface for hardware wallet devices (Ledger, Trezor).
 * Adds lifecycle methods for connection management and app version querying.
 */
export interface HardwareWalletAdapter extends WalletAdapter {
  /** Identifies the hardware wallet type. */
  readonly type: 'ledger' | 'trezor'
  /** Opens a connection to the hardware wallet device. */
  connect(): Promise<void>
  /** Closes the connection to the hardware wallet device. */
  disconnect(): Promise<void>
  /** Returns the version string of the Stellar app installed on the device. */
  getAppVersion(): Promise<string>
}

/**
 * Configuration for the Ledger hardware wallet adapter.
 *
 * @example
 * ```typescript
 * import TransportWebUSB from '@ledgerhq/hw-transport-webusb'
 * import { createLedgerAdapter } from '@soroban-resurrect/sdk'
 *
 * const transport = await TransportWebUSB.create()
 * const adapter = createLedgerAdapter({ transport, accountIndex: 0 })
 * ```
 */
export interface LedgerAdapterConfig {
  /** BIP32 account index used to derive the Stellar key path m/44'/148'/accountIndex'. Defaults to 0. */
  accountIndex?: number
  /**
   * A Ledger transport instance (e.g. from `@ledgerhq/hw-transport-webusb`).
   * The transport must expose `send(cla, ins, p1, p2, data)` and `close()`.
   * Pass this in so you can use any transport without the SDK depending on the package directly.
   */
  transport?: unknown
}

/**
 * Configuration for the Trezor hardware wallet adapter.
 *
 * @example
 * ```typescript
 * import TrezorConnect from '@trezor/connect-web'
 * import { createTrezorAdapter } from '@soroban-resurrect/sdk'
 *
 * const adapter = createTrezorAdapter({
 *   trezorConnect: TrezorConnect,
 *   manifest: { email: 'you@example.com', appUrl: 'https://your-app.com' },
 *   accountIndex: 0,
 * })
 * ```
 */
export interface TrezorAdapterConfig {
  /** BIP32 account index used to derive the Stellar key path m/44'/148'/accountIndex'/0/0. Defaults to 0. */
  accountIndex?: number
  /** Required by Trezor Connect to identify your application. */
  manifest: { email: string; appUrl: string }
  /**
   * A TrezorConnect instance (e.g. from `@trezor/connect-web` or `trezor-connect`).
   * Pass this in so you can use any Trezor Connect package without the SDK depending on it directly.
   */
  trezorConnect?: unknown
}

/** Represents a single ledger entry that has been archived (expired TTL). */
export interface ArchivedLedgerEntry {
  /** The raw ledger key. */
  key: xdr.LedgerKey
  /** Base64-encoded string representation of the ledger key. */
  keyBase64: string
}

/** Convenience alias for the Soroban RPC simulate response type. */
export type SimulateResponse = rpc.Api.SimulateTransactionResponse

/** Result returned from the restore-and-submit workflow. */
export interface ResurrectResult {
  /** Whether the full transaction lifecycle succeeded. */
  success: boolean
  /** Hash of the submitted original transaction (present on success). */
  originalTxHash?: string
  /** Hash of the submitted restore transaction (present if restore was needed). */
  restoreTxHash?: string
  /** Number of archived ledger entries that were detected and restored. */
  archivedKeysDetected: number
  /** Error message if the workflow failed. */
  error?: string
}

/** Options for submitting a transaction with automatic archive restoration. */
export interface SubmitWithRestoreOptions {
  /** The Soroban transaction to submit. */
  transaction: Transaction
  /** Wallet adapter used for signing. */
  wallet: WalletAdapter
  /** Called when restore transaction is ready to be signed. */
  onSigningRestore?: () => void
  /** Called after restore transaction is signed and being submitted. */
  onSubmittingRestore?: () => void
  /** Called after restore transaction is confirmed and original is ready to sign. */
  onSigningOriginal?: () => void
  /** Called when archived entries are detected and restoration is required. */
  onRestoreNeeded?: (archivedKeys: ArchivedLedgerEntry[]) => void
  /** Called after the restore transaction is submitted. */
  onRestoreSubmitted?: (txHash: string) => void
  /** Called after the restore transaction is confirmed on-chain. */
  onRestoreConfirmed?: (txHash: string) => void
  /** Called after the original transaction is submitted. */
  onOriginalSubmitted?: (txHash: string) => void
  /** Called when the restore step of the workflow fails. */
  onRestoreFailed?: (error: string) => void
}

/** Tracks the current stage of the restore-and-submit workflow. */
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
