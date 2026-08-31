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
export type ResurrectErrorCode =
  /**
   * The wallet adapter returned `false` from `isConnected()`.
   * The user must connect their wallet before retrying.
   */
  | 'WALLET_NOT_CONNECTED'

  /**
   * The Soroban RPC simulation returned an error response.
   * Check `result.error` for the underlying RPC error message.
   */
  | 'SIMULATION_FAILED'

  /**
   * The restore transaction was signed but could not be parsed from XDR.
   * This is usually a wallet adapter bug or a network passphrase mismatch.
   */
  | 'RESTORE_TX_PARSE_FAILED'

  /**
   * The restore transaction was submitted but the on-chain result was
   * `FAILED`. Check `result.restoreTxHash` to inspect the transaction.
   */
  | 'RESTORE_TX_FAILED'

  /**
   * The original transaction was signed but could not be parsed from XDR
   * after the restore step. Usually a wallet adapter bug.
   */
  | 'ORIGINAL_TX_PARSE_FAILED'

  /**
   * The submitted original transaction did not reach `SUCCESS` status
   * within the polling timeout.
   */
  | 'ORIGINAL_TX_FAILED'

  /**
   * The simulation response was not a recognised type (not success, error,
   * or restore). This indicates a Soroban RPC API change or an SDK bug.
   */
  | 'UNEXPECTED_SIMULATION_RESPONSE'

  /**
   * An unexpected JavaScript exception was thrown during the workflow.
   * Check `result.error` for the exception message.
   */
  | 'UNKNOWN_ERROR'

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
