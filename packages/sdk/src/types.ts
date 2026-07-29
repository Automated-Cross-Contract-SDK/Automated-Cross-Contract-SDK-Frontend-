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
 * Sponsor interface for fee-bump transactions.
 * A fee-bump sponsor pays the transaction fees on behalf of the user
 * by wrapping the inner (user-signed) transaction in a fee-bump envelope.
 */
export interface FeeBumpSponsor {
  /** Returns the sponsor's public key (the account that pays the fee). */
  getPublicKey(): Promise<string>
  /**
   * Signs a fee-bump transaction XDR string.
   * The provided XDR is a fully constructed FeeBumpTransaction envelope
   * wrapping the user-signed inner transaction.
   */
  signFeeBump(
    txXdr: string,
    opts?: { networkPassphrase?: string },
  ): Promise<string>
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
  feeBumpFee?: string
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
