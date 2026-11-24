import type { ExpiredTransactionInfo } from './types.js'

function captureStackTrace(target: object, constructor: unknown): void {
  const { captureStackTrace: capture } = Error as {
    captureStackTrace?: (target: object, constructor: unknown) => void
  }
  capture?.(target, constructor)
}

/**
 * Structured error codes for ResurrectResult — similar to GraphQL's
 * `extensions.code` pattern. Consumers can branch on these codes
 * programmatically without parsing error message strings.
 *
 * @example
 * ```ts
 * const result = await sr.submitWithRestore({ transaction, wallet })
 * if (!result.success) {
 *   switch (result.errorCode) {
 *     case 'WALLET_NOT_CONNECTED':
 *       promptUserToConnect()
 *       break
 *     case 'RESTORE_TX_FAILED':
 *       showRestoreFailedUI(result.restoreTxHash)
 *       break
 *     default:
 *       showGenericError(result.error)
 *   }
 * }
 * ```
 */
export const ResurrectErrorCode = {
  /**
   * The wallet adapter returned `false` from `isConnected()`.
   * The user must connect their wallet before retrying.
   */
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',

  /**
   * The Soroban RPC simulation returned an error response.
   * Check `result.error` for the underlying RPC error message.
   */
  SIMULATION_FAILED: 'SIMULATION_FAILED',

  /**
   * The computed restore fee exceeds the configured fee cap.
   */
  RESTORE_FEE_CAP_EXCEEDED: 'RESTORE_FEE_CAP_EXCEEDED',

  /**
   * The restore transaction was signed but could not be parsed from XDR.
   * This is usually a wallet adapter bug or a network passphrase mismatch.
   */
  RESTORE_TX_PARSE_FAILED: 'RESTORE_TX_PARSE_FAILED',

  /**
   * The restore transaction was submitted but the on-chain result was
   * `FAILED`. Check `result.restoreTxHash` to inspect the transaction.
   */
  RESTORE_TX_FAILED: 'RESTORE_TX_FAILED',

  /**
   * The original transaction was signed but could not be parsed from XDR
   * after the restore step. Usually a wallet adapter bug.
   */
  ORIGINAL_TX_PARSE_FAILED: 'ORIGINAL_TX_PARSE_FAILED',

  /**
   * The submitted original transaction reached a terminal `FAILED` status.
   */
  ORIGINAL_TX_FAILED: 'ORIGINAL_TX_FAILED',

  /** The original transaction expired during restoration and needs approval to rebuild. */
  ORIGINAL_TRANSACTION_EXPIRED: 'ORIGINAL_TRANSACTION_EXPIRED',

  /** Caller-provided replacement time bounds are invalid or already expired. */
  INVALID_REBUILD_TIME_BOUNDS: 'INVALID_REBUILD_TIME_BOUNDS',

  /**
   * Transaction confirmation polling timed out before a terminal status.
   * Inspect the transaction hash; the network outcome may still be pending.
   */
  CONFIRMATION_TIMEOUT: 'CONFIRMATION_TIMEOUT',

  /**
   * The simulation response was not a recognised type (not success, error,
   * or restore). This indicates a Soroban RPC API change or an SDK bug.
   */
  UNEXPECTED_SIMULATION_RESPONSE: 'UNEXPECTED_SIMULATION_RESPONSE',

  /**
   * A restore response did not include a complete, usable footprint.
   * Check `result.error` for the response condition; no restore transaction
   * was constructed or submitted.
   */
  INCOMPLETE_FOOTPRINT: 'INCOMPLETE_FOOTPRINT',

  /**
   * The connected wallet declared that it does not support a required
   * capability (e.g. `capabilities.feeBump === false` or
   * `capabilities.signAuthEntry === false`). The caller should surface a
   * "wallet not supported" message rather than a generic failure.
   */
  UNSUPPORTED_WALLET_CAPABILITY: 'UNSUPPORTED_WALLET_CAPABILITY',

  /** A restore memo is invalid or exceeds Stellar's 28-byte text memo limit. */
  INVALID_RESTORE_MEMO: 'INVALID_RESTORE_MEMO',

  /** A caller exceeded a configured batch-size limit. */
  BATCH_SIZE_EXCEEDED: 'BATCH_SIZE_EXCEEDED',

  /** A wallet returned a fee-bump envelope when a plain transaction was signed. */
  UNEXPECTED_FEE_BUMP_ENVELOPE: 'UNEXPECTED_FEE_BUMP_ENVELOPE',

  /** A wallet returned a transaction with different requested transaction data. */
  SIGNED_TRANSACTION_MISMATCH: 'SIGNED_TRANSACTION_MISMATCH',

  /** Archive detection failed for one or more entries in a batch. */
  ARCHIVE_DETECTION_BATCH_FAILED: 'ARCHIVE_DETECTION_BATCH_FAILED',

  /**
   * The estimated restore fee exceeded the configured cap. Review the fee
   * limit or wait until the network fee is lower.
   */

  /** The restoreKeys call received no ledger keys. */
  INVALID_RESTORE_KEYS: 'INVALID_RESTORE_KEYS',

  /**
   * An unexpected JavaScript exception was thrown during the workflow.
   * Check `result.error` for the exception message.
   */
  /** An RPC call exceeded its configured timeout. */
  RPC_TIMEOUT: 'RPC_TIMEOUT',

  /** An RPC call failed at the transport level, or the circuit breaker is open. */
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',

  /**
   * The caller aborted the workflow. A transaction already submitted to the
   * network cannot be cancelled; inspect its hash/status before retrying.
   */
  ABORTED: 'ABORTED',
  /** The wallet rejected or failed a signing request. */
  SIGNING_FAILED: 'SIGNING_FAILED',
  /** A workflow phase or confirmation exceeded its deadline. */
  TIMEOUT: 'TIMEOUT',
  /** Caller-provided configuration or input is invalid. */
  INVALID_INPUT: 'INVALID_INPUT',
} as const

export type ResurrectErrorCode = (typeof ResurrectErrorCode)[keyof typeof ResurrectErrorCode]

/**
 * Structured error thrown by SDK methods that use exception-based error
 * handling. Carries a machine-readable `code` alongside the human-readable
 * `message`, matching the GraphQL-like error pattern used in `ResurrectResult`.
 *
 * @example
 * ```ts
 * try {
 *   await sr.buildRestoreTx(publicKey, tx)
 * } catch (err) {
 *   if (err instanceof ResurrectError) {
 *     console.error(err.code, err.message)
 *   }
 * }
 * ```
 */
export class ResurrectError extends Error {
  /** Machine-readable error code for programmatic branching. */
  readonly code: ResurrectErrorCode

  constructor(code: ResurrectErrorCode, message: string) {
    super(message)
    this.name = 'ResurrectError'
    this.code = code
    // Maintains proper stack trace in V8 environments (Node.js / Chrome).
    captureStackTrace(this, ResurrectError)
  }
}

/** Typed error raised when rebuilding would otherwise extend an expired transaction. */
export class OriginalTransactionExpiredError extends ResurrectError {
  readonly expiredTransaction: ExpiredTransactionInfo

  constructor(expiredTransaction: ExpiredTransactionInfo) {
    super(
      'ORIGINAL_TRANSACTION_EXPIRED',
      'Original transaction time bounds have expired; explicit approval is required to rebuild',
    )
    this.name = 'OriginalTransactionExpiredError'
    this.expiredTransaction = expiredTransaction
  }
}

/**
 * Thrown when a computed restore fee exceeds the configured
 * `maxRestoreFeeStroops` cap. Carries both the computed fee and the cap so
 * callers can surface or log the exact numbers without parsing the message.
 *
 * @example
 * ```ts
 * try {
 *   await sr.buildRestoreTx(publicKey, tx)
 * } catch (err) {
 *   if (err instanceof RestoreFeeExceededError) {
 *     console.error(`fee ${err.computedFeeStroops} > cap ${err.maxFeeStroops}`)
 *   }
 * }
 * ```
 */
export class RestoreFeeExceededError extends ResurrectError {
  /** The fee computed from the restore footprint, in stroops. */
  readonly computedFeeStroops: number

  /** The configured `maxRestoreFeeStroops` cap, in stroops. */
  readonly maxFeeStroops: number

  constructor(computedFeeStroops: number, maxFeeStroops: number) {
    super(
      'RESTORE_FEE_CAP_EXCEEDED',
      `Computed restore fee ${computedFeeStroops} stroops exceeds the configured maxRestoreFeeStroops cap of ${maxFeeStroops} stroops`,
    )
    this.name = 'RestoreFeeExceededError'
    this.computedFeeStroops = computedFeeStroops
    this.maxFeeStroops = maxFeeStroops
    // Maintains proper stack trace in V8 environments (Node.js / Chrome).
    captureStackTrace(this, RestoreFeeExceededError)
  }
}

/** Base for errors tied to one stable code; `cause` keeps the original error. */
abstract class CodedError extends ResurrectError {
  readonly originalError?: unknown

  constructor(code: ResurrectErrorCode, name: string, message: string, originalError?: unknown) {
    super(code, message)
    this.name = name
    if (originalError !== undefined) this.originalError = originalError
  }
}

/** The RPC endpoint could not be reached. */
export class NetworkError extends CodedError {
  constructor(message: string, originalError?: unknown) {
    super('NETWORK_ERROR', 'NetworkError', message, originalError)
  }
}

/** Transaction simulation failed. */
export class SimulationError extends CodedError {
  constructor(message: string, originalError?: unknown) {
    super('SIMULATION_FAILED', 'SimulationError', message, originalError)
  }
}

/** The wallet rejected or failed a signing request. */
export class SigningError extends CodedError {
  constructor(message: string, originalError?: unknown) {
    super('SIGNING_FAILED', 'SigningError', message, originalError)
  }
}

/** A restore transaction failed. */
export class RestoreError extends CodedError {
  constructor(message: string, originalError?: unknown) {
    super('RESTORE_TX_FAILED', 'RestoreError', message, originalError)
  }
}

/** A workflow phase or confirmation exceeded its deadline. */
export class ResurrectTimeoutError extends CodedError {
  constructor(message: string, originalError?: unknown) {
    super('TIMEOUT', 'ResurrectTimeoutError', message, originalError)
  }
}

/** Caller-provided configuration or input is invalid. */
export class InvalidInputError extends CodedError {
  constructor(message: string, originalError?: unknown) {
    super('INVALID_INPUT', 'InvalidInputError', message, originalError)
  }
}

/** Stable code of any thrown value; `UNKNOWN_ERROR` when it carries none. */
export function getResurrectErrorCode(error: unknown): ResurrectErrorCode {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && Object.hasOwn(ResurrectErrorCode, code)
    ? (code as ResurrectErrorCode)
    : 'UNKNOWN_ERROR'
}

/** Runs a signing operation, normalizing unstructured failures to {@link SigningError}. */
export async function wrapSigningError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ResurrectError) throw error
    throw new SigningError(error instanceof Error ? error.message : String(error), error)
  }
}
