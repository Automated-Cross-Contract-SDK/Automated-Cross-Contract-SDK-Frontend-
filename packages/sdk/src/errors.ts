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
  /** RPC or transport request failed. */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** Soroban RPC simulation failed. */
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  /** Wallet could not sign a transaction or authorization entry. */
  SIGNING_FAILED: 'SIGNING_FAILED',
  /** A transaction did not reach a terminal state before its deadline. */
  TIMEOUT: 'TIMEOUT',
  /** Caller-provided configuration or operation input is invalid. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** RPC request exceeded its configured deadline. */
  RPC_TIMEOUT: 'RPC_TIMEOUT',
  /** The wallet adapter returned `false` from `isConnected()`. */
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
  /** The signed restore transaction could not be parsed from XDR. */
  RESTORE_TX_PARSE_FAILED: 'RESTORE_TX_PARSE_FAILED',
  /** The on-chain restore transaction failed. */
  RESTORE_TX_FAILED: 'RESTORE_TX_FAILED',
  /** The configured restore fee cap was exceeded. */
  RESTORE_FEE_CAP_EXCEEDED: 'RESTORE_FEE_CAP_EXCEEDED',
  /** The signed original transaction could not be parsed from XDR. */
  ORIGINAL_TX_PARSE_FAILED: 'ORIGINAL_TX_PARSE_FAILED',
  /** The on-chain original transaction failed. */
  ORIGINAL_TX_FAILED: 'ORIGINAL_TX_FAILED',
  /** The simulation response did not match a supported response shape. */
  UNEXPECTED_SIMULATION_RESPONSE: 'UNEXPECTED_SIMULATION_RESPONSE',
  /** The wallet does not support a capability required by the workflow. */
  UNSUPPORTED_WALLET_CAPABILITY: 'UNSUPPORTED_WALLET_CAPABILITY',
  /** An unexpected exception was thrown during the workflow. */
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

/** Stable, machine-readable codes for SDK workflow and validation failures. */
export type ResurrectErrorCode =
  (typeof ResurrectErrorCode)[keyof typeof ResurrectErrorCode]

/** Returns a stable code for a thrown SDK error, falling back to UNKNOWN_ERROR. */
export function getResurrectErrorCode(error: unknown): ResurrectErrorCode {
  if (error instanceof ResurrectError) return error.code
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = error.code
    if (typeof code === 'string' && Object.values(ResurrectErrorCode).includes(code as ResurrectErrorCode)) {
      return code as ResurrectErrorCode
    }
    if (code === 'NETWORK_MISMATCH') return ResurrectErrorCode.NETWORK_ERROR
    if (code === 'USER_REJECTED' || code === 'NOT_CONNECTED') return ResurrectErrorCode.SIGNING_FAILED
  }
  return ResurrectErrorCode.UNKNOWN_ERROR
}

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
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ResurrectError)
    }
  }
}

/** Category-specific error carrying the same stable code used by result values. */
export class NetworkError extends ResurrectError {
  readonly originalError: unknown

  constructor(message: string, originalError?: unknown) {
    super(ResurrectErrorCode.NETWORK_ERROR, message)
    this.name = 'NetworkError'
    this.originalError = originalError
  }
}

/** Error raised when transaction simulation cannot complete successfully. */
export class SimulationError extends ResurrectError {
  constructor(message: string) {
    super(ResurrectErrorCode.SIMULATION_FAILED, message)
    this.name = 'SimulationError'
  }
}

/** Error raised when a wallet refuses or fails to sign. */
export class SigningError extends ResurrectError {
  constructor(message: string) {
    super(ResurrectErrorCode.SIGNING_FAILED, message)
    this.name = 'SigningError'
  }
}

/** Converts a rejected wallet or sponsor signing operation to `SIGNING_FAILED`. */
export async function wrapSigningError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ResurrectError) throw error
    throw new SigningError(error instanceof Error ? error.message : String(error))
  }
}

/** Error raised when a restore operation fails outside on-chain failure results. */
export class RestoreError extends ResurrectError {
  constructor(message: string) {
    super(ResurrectErrorCode.RESTORE_TX_FAILED, message)
    this.name = 'RestoreError'
  }
}

/** Error raised when a polling operation reaches its configured deadline. */
export class ResurrectTimeoutError extends ResurrectError {
  constructor(message: string) {
    super(ResurrectErrorCode.TIMEOUT, message)
    this.name = 'ResurrectTimeoutError'
  }
}

/** Error raised when caller-provided configuration or operation input is invalid. */
export class InvalidInputError extends ResurrectError {
  constructor(message: string) {
    super(ResurrectErrorCode.INVALID_INPUT, message)
    this.name = 'InvalidInputError'
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
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RestoreFeeExceededError)
    }
  }
}
