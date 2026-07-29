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
  /** True when the result came from a dry-run (no transactions submitted). */
  dryRun?: boolean
  /** Detailed dry-run information (present when dryRun is true). */
  dryRunResult?: DryRunResult
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
  estimatedRestoreFee?: string
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
   * When true, performs all simulation and detection steps but does NOT sign
   * or submit any transactions. Useful for UI previews (e.g. showing the user
   * what would happen before they confirm).
   *
   * The returned \`ResurrectResult\` will have \`dryRun: true\` and a populated
   * \`dryRunResult\` field with the simulation findings.
   */
  dryRun?: boolean
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
