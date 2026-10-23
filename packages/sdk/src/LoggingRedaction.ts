/**
 * Privacy-safe logging defaults and redaction controls.
 *
 * Specifies which fields may contain sensitive data and provides tested
 * redaction utilities for common transaction and account identifiers.
 *
 * ## Privacy Guidelines
 *
 * **NEVER log or emit:**
 * - Private keys or secrets
 * - Wallet addresses (in plaintext)
 * - Transaction XDR or full transaction objects
 * - Authorization preimages or signatures
 * - Account sequences or full ledger entries
 *
 * **SAFE to log:**
 * - Workflow IDs (opaque, no information encoded)
 * - Stage names and error codes (not full error messages)
 * - Durations, retry counts, and cardinality
 * - Redacted identifiers (hash suffixes only)
 * - SDK version and environment info
 */

/**
 * Privacy classification for common field types.
 *
 * @public
 */
export enum LoggingFieldType {
  /** Safe to log in full. */
  Public = 'public',

  /** Must be redacted (hash suffix only). */
  Sensitive = 'sensitive',

  /** NEVER log, even redacted. */
  Forbidden = 'forbidden',
}

/**
 * Privacy classification for a specific field.
 *
 * @public
 */
export interface LoggingFieldClassification {
  /** Field name. */
  field: string;

  /** Privacy category. */
  type: LoggingFieldType;

  /** Human-readable description. */
  reason: string;

  /** Redaction function to use (if type is Sensitive). */
  redactFn?: (value: string) => string;
}

/**
 * Predefined field classifications for common SDK objects.
 *
 * @public
 */
export const LoggingClassifications: LoggingFieldClassification[] = [
  // Forbidden fields
  {
    field: 'privateKey',
    type: LoggingFieldType.Forbidden,
    reason: 'Private key material must never be logged',
  },
  {
    field: 'secret',
    type: LoggingFieldType.Forbidden,
    reason: 'Secret key must never be logged',
  },
  {
    field: 'authorization',
    type: LoggingFieldType.Forbidden,
    reason: 'Authorization preimages must never be logged',
  },
  {
    field: 'signature',
    type: LoggingFieldType.Forbidden,
    reason: 'Signatures must never be logged',
  },
  {
    field: 'xdr',
    type: LoggingFieldType.Forbidden,
    reason: 'Full transaction XDR may contain sensitive data',
  },
  {
    field: 'transactionEnvelope',
    type: LoggingFieldType.Forbidden,
    reason: 'Transaction envelope contains full transaction data',
  },

  // Sensitive fields (redact as hash)
  {
    field: 'address',
    type: LoggingFieldType.Sensitive,
    reason: 'Wallet address is PII, log only hash suffix',
    redactFn: (val) => RedactionUtils.hashAddress(val),
  },
  {
    field: 'publicKey',
    type: LoggingFieldType.Sensitive,
    reason: 'Public key identifies account, log only hash suffix',
    redactFn: (val) => RedactionUtils.hashAddress(val),
  },
  {
    field: 'contractId',
    type: LoggingFieldType.Sensitive,
    reason: 'Contract ID identifies contract, log only hash suffix',
    redactFn: (val) => RedactionUtils.hashSuffix(val),
  },
  {
    field: 'txHash',
    type: LoggingFieldType.Sensitive,
    reason: 'Transaction hash may be used to identify transactions, use only for correlation',
    redactFn: (val) => RedactionUtils.hashSuffix(val, 8),
  },
  {
    field: 'accountSequence',
    type: LoggingFieldType.Sensitive,
    reason: 'Account sequence can help identify transactions',
    redactFn: (val) => `seq_${val.slice(-4)}`,
  },

  // Public fields
  {
    field: 'workflowId',
    type: LoggingFieldType.Public,
    reason: 'Opaque correlation ID safe to log',
  },
  {
    field: 'stage',
    type: LoggingFieldType.Public,
    reason: 'Workflow stage name is safe to log',
  },
  {
    field: 'errorCode',
    type: LoggingFieldType.Public,
    reason: 'Machine-readable error code is safe to log',
  },
  {
    field: 'durationMs',
    type: LoggingFieldType.Public,
    reason: 'Duration metric is safe to log',
  },
  {
    field: 'retries',
    type: LoggingFieldType.Public,
    reason: 'Retry count metric is safe to log',
  },
  {
    field: 'networkPassphrase',
    type: LoggingFieldType.Public,
    reason: 'Network identifier (testnet/mainnet) is safe to log',
  },
  {
    field: 'sdkVersion',
    type: LoggingFieldType.Public,
    reason: 'SDK version is safe to log',
  },
];

/**
 * Redaction utilities for common sensitive identifiers.
 *
 * @public
 */
export const RedactionUtils = {
  /**
   * Redacts a wallet address or public key to a safe hash suffix.
   *
   * @param address - Full address or public key.
   * @returns Safe identifier like `"GA...b2c3"` (prefix and last 4 chars).
   *
   * @example
   * ```ts
   * const addr = 'GABC...XYZ123';
   * const safe = RedactionUtils.hashAddress(addr);
   * // safe = "GA...Z123"
   * ```
   */
  hashAddress(address: string): string {
    if (!address || address.length < 6) return '***';
    const prefix = address.slice(0, 2);
    const suffix = address.slice(-4);
    return `${prefix}...${suffix}`;
  },

  /**
   * Redacts any hex string to its last N characters.
   *
   * @param hexString - Any hex string (hash, contract ID, etc.).
   * @param chars - Number of trailing characters to keep (default 4).
   * @returns Safe identifier like `"...abc123"`.
   *
   * @example
   * ```ts
   * const contractId = 'cab23fabe1234567890123456789abcdef';
   * const safe = RedactionUtils.hashSuffix(contractId, 8);
   * // safe = "...89abcdef"
   * ```
   */
  hashSuffix(hexString: string, chars: number = 4): string {
    if (!hexString || hexString.length < chars) return '***';
    const suffix = hexString.slice(-chars);
    return `...${suffix}`;
  },

  /**
   * Redacts transaction envelope or full transaction XDR.
   *
   * Never logs the XDR itself; instead returns a placeholder.
   *
   * @param _txXdr - Transaction XDR (ignored for safety).
   * @returns Safe placeholder.
   *
   * @example
   * ```ts
   * const xdr = 'AAAAAgAAAAB...'; // very long
   * const safe = RedactionUtils.redactXdr(xdr);
   * // safe = "[XDR redacted]"
   * ```
   */
  redactXdr(_txXdr: string): string {
    return '[XDR redacted]';
  },

  /**
   * Filters an object to include only safe (public) fields.
   *
   * Recursively removes forbidden and sensitive fields.
   *
   * @param obj - Object to filter.
   * @param allowSensitive - If true, include sensitive fields (redacted).
   * @returns Filtered object safe for logging.
   *
   * @example
   * ```ts
   * const result = {
   *   workflowId: 'wf_123',
   *   address: 'GA...xyz',
   *   privateKey: 'S...',
   *   durationMs: 150,
   * };
   *
   * const safe = RedactionUtils.filterObject(result);
   * // Returns: { workflowId: 'wf_123', durationMs: 150 }
   *
   * const withRedacted = RedactionUtils.filterObject(result, true);
   * // Returns: { workflowId: 'wf_123', address: 'GA...xyz', durationMs: 150 }
   * ```
   */
  filterObject(
    obj: Record<string, unknown>,
    allowSensitive: boolean = false,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const forbiddenFields = LoggingClassifications.filter(
      (c) => c.type === LoggingFieldType.Forbidden,
    ).map((c) => c.field.toLowerCase());

    const sensitiveFields = LoggingClassifications.filter(
      (c) => c.type === LoggingFieldType.Sensitive,
    ).map((c) => c.field.toLowerCase());

    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();

      if (forbiddenFields.includes(keyLower)) {
        continue;
      }

      if (sensitiveFields.includes(keyLower)) {
        if (allowSensitive && typeof value === 'string') {
          const classification = LoggingClassifications.find(
            (c) => c.field.toLowerCase() === keyLower,
          );
          if (classification?.redactFn) {
            result[key] = classification.redactFn(value);
          }
        }
        continue;
      }

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = RedactionUtils.filterObject(
          value as Record<string, unknown>,
          allowSensitive,
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  },

  /**
   * Checks if a field name is forbidden to log.
   *
   * @param fieldName - Field name to check.
   * @returns True if the field should never be logged.
   */
  isForbidden(fieldName: string): boolean {
    const lowerName = fieldName.toLowerCase();
    return LoggingClassifications.some(
      (c) =>
        c.type === LoggingFieldType.Forbidden &&
        c.field.toLowerCase() === lowerName,
    );
  },

  /**
   * Checks if a field is sensitive (needs redaction).
   *
   * @param fieldName - Field name to check.
   * @returns True if the field should be redacted before logging.
   */
  isSensitive(fieldName: string): boolean {
    const lowerName = fieldName.toLowerCase();
    return LoggingClassifications.some(
      (c) =>
        c.type === LoggingFieldType.Sensitive &&
        c.field.toLowerCase() === lowerName,
    );
  },
} as const;

/**
 * Safe logger wrapper that automatically redacts sensitive fields.
 *
 * @public
 */
export class SafeLogger {
  private allowSensitive: boolean;

  /**
   * Creates a safe logger instance.
   *
   * @param allowSensitive - If true, log sensitive fields (redacted). Default false.
   */
  constructor(allowSensitive: boolean = false) {
    this.allowSensitive = allowSensitive;
  }

  /**
   * Logs an object, filtering and redacting sensitive fields.
   *
   * @param label - Log message label.
   * @param obj - Object to log.
   * @param logger - Logger function (default: console.log).
   */
  info(
    label: string,
    obj: Record<string, unknown>,
    logger: (msg: string) => void = console.log,
  ): void {
    const filtered = RedactionUtils.filterObject(obj, this.allowSensitive);
    logger(`${label}: ${JSON.stringify(filtered)}`);
  }

  /**
   * Logs an error, filtering and redacting sensitive fields.
   *
   * @param label - Error message label.
   * @param err - Error object.
   * @param context - Optional context object.
   * @param logger - Logger function (default: console.error).
   */
  error(
    label: string,
    err: unknown,
    context?: Record<string, unknown>,
    logger: (msg: string) => void = console.error,
  ): void {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Unknown error';
    const filtered = context ? RedactionUtils.filterObject(context, this.allowSensitive) : {};
    logger(`${label}: ${message} ${JSON.stringify(filtered)}`);
  }
}
