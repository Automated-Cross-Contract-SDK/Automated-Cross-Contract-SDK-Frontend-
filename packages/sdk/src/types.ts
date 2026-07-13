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
  /** Called when archived entries are detected and restoration is required. */
  onRestoreNeeded?: (archivedKeys: ArchivedLedgerEntry[]) => void
  /** Called after the restore transaction is submitted. */
  onRestoreSubmitted?: (txHash: string) => void
  /** Called after the restore transaction is confirmed on-chain. */
  onRestoreConfirmed?: (txHash: string) => void
  /** Called after the original transaction is submitted. */
  onOriginalSubmitted?: (txHash: string) => void
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
