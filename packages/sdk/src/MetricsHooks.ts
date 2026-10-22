/**
 * Framework-neutral metrics hooks for success, failure, and recovery outcomes.
 *
 * This module provides a stable, extensible interface for observing SDK lifecycle
 * events without coupling to any specific metrics library or APM vendor.
 *
 * ## Cardinality Constraints
 *
 * Metric names, outcome codes, and stage names are from a fixed set to prevent
 * unbounded cardinality growth. Custom labels should use low-cardinality values only.
 *
 * ## Privacy
 *
 * Hooks receive only safe metadata: no wallet addresses, keys, transaction XDR,
 * or other sensitive data. See {@link MetricsRedaction} for logging guidelines.
 */

/**
 * Known stages in the restore workflow.
 *
 * @public
 */
export type MetricsStage =
  | 'initialization'
  | 'simulation'
  | 'restore_preparation'
  | 'restore_submission'
  | 'restore_confirmation'
  | 'original_submission'
  | 'original_confirmation'
  | 'finalization';

/**
 * Known outcome codes (no wallet addresses or transaction data).
 *
 * @public
 */
export type MetricsOutcomeCode =
  | 'SUCCESS'
  | 'NO_RESTORE_NEEDED'
  | 'SIMULATION_FAILED'
  | 'RESTORE_SUBMITTED'
  | 'RESTORE_CONFIRMED'
  | 'RESTORE_TIMEOUT'
  | 'RESTORE_FAILED'
  | 'ORIGINAL_FAILED'
  | 'ABORTED_BY_USER'
  | 'NETWORK_ERROR'
  | 'RPC_ERROR'
  | 'INVALID_CONFIG'
  | 'UNKNOWN_ERROR';

/**
 * Metadata safe to emit for a workflow completion.
 *
 * Intentionally excludes: wallet address, transaction XDR/hash, error messages,
 * contract IDs, private keys, or any other PII.
 *
 * @public
 */
export interface MetricsOutcomeMetadata {
  /** Unique workflow ID for correlation. */
  workflowId?: string;

  /** Final stage reached. */
  stage?: MetricsStage;

  /** Machine-readable outcome code. */
  outcomeCode?: MetricsOutcomeCode;

  /** Total workflow duration in milliseconds. */
  durationMs?: number;

  /** Number of times a transient error was retried. */
  retries?: number;

  /** Number of ledger entries archived (if applicable). */
  archivedKeysCount?: number;

  /** Estimated restore fee in stroops (if applicable). */
  estimatedRestoreFeeStoops?: number;

  /** Custom, low-cardinality labels (not wallet addresses or hashes). */
  customLabels?: Record<string, string | number | boolean>;
}

/**
 * Metadata safe to emit for a recovery or retry event.
 *
 * @public
 */
export interface MetricsRecoveryMetadata {
  /** Unique workflow ID for correlation. */
  workflowId?: string;

  /** Stage at which recovery was triggered. */
  stage?: MetricsStage;

  /** Low-cardinality error category (not full error message). */
  errorCategory?: string;

  /** Retry attempt number (1, 2, 3, ...). */
  attemptNumber?: number;

  /** Delay before next retry in milliseconds. */
  backoffMs?: number;

  /** Custom, low-cardinality labels. */
  customLabels?: Record<string, string | number | boolean>;
}

/**
 * Framework-neutral metrics hook interface.
 *
 * Implement this and pass to {@link SorobanResurrectConfig.metricsHook}
 * to observe SDK lifecycle events. All methods are optional.
 *
 * @public
 */
export interface MetricsHook {
  /**
   * Called when a workflow completes (success or final failure).
   *
   * @param metadata - Safe metadata about the outcome.
   */
  onOutcome?(metadata: MetricsOutcomeMetadata): void | Promise<void>;

  /**
   * Called when a recoverable error is detected and a retry is scheduled.
   *
   * @param metadata - Safe metadata about the recovery attempt.
   */
  onRecovery?(metadata: MetricsRecoveryMetadata): void | Promise<void>;

  /**
   * Called periodically during long operations (polling, simulation, etc.)
   * to report progress and intermediate metrics.
   *
   * @param stage - Current workflow stage.
   * @param progressMetadata - Optional safe metadata about progress.
   */
  onProgress?(
    stage: MetricsStage,
    progressMetadata?: Record<string, string | number | boolean>,
  ): void | Promise<void>;
}

/**
 * Guidelines for privacy-safe metrics collection.
 *
 * @public
 */
export const MetricsRedaction = {
  /**
   * Fields that MUST NEVER be emitted in metrics or logs.
   */
  forbidden: [
    'wallet address',
    'public key (PK)',
    'private key (SK)',
    'transaction hash',
    'transaction XDR',
    'contract ID',
    'account sequence',
    'authorization preimage',
    'signature',
  ] as const,

  /**
   * Fields that MAY be emitted only as redacted hashes.
   */
  redactAsHash: [
    'wallet address (hash last 4 chars)',
    'contract ID (hash last 4 chars)',
    'transaction hash (for correlation only)',
  ] as const,

  /**
   * Safe fields to emit.
   */
  safe: [
    'workflow ID',
    'stage name',
    'outcome code',
    'duration',
    'retry count',
    'archived key count',
    'error category (not message)',
    'environment (testnet/mainnet)',
    'SDK version',
    'network passphrase',
  ] as const,

  /**
   * Redaction helper: extract last N characters of a hex string as a safe ID.
   *
   * @param hexString - The full hex string (e.g., address or hash).
   * @param chars - Number of trailing characters to keep (default 4).
   * @returns A safe identifier like `"addr_a1b2"`.
   *
   * @example
   * ```ts
   * const publicKey = 'GABC...XYZ';
   * const safeId = MetricsRedaction.hashSuffix(publicKey, 4);
   * // safeId = "pk_XYZ" (last 4 chars only)
   * ```
   */
  hashSuffix(hexString: string, chars: number = 4): string {
    if (!hexString || hexString.length < chars) return '';
    return hexString.slice(-chars);
  },
} as const;
