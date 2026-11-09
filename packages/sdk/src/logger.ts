/**
 * Injectable logger interface used across the SDK.
 *
 * Consumers may provide their own implementation via `config.logger` to
 * redirect or silence SDK diagnostics. When no logger is supplied the SDK
 * falls back to {@link NOOP_LOGGER} so that nothing is written to the console.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * A {@link Logger} that discards every message.
 *
 * Used as the default so the SDK never writes to the console unless a
 * consumer explicitly injects a logger.
 */
export const NOOP_LOGGER: Logger = {
  debug(): void {
    /* noop */
  },
  info(): void {
    /* noop */
  },
  warn(): void {
    /* noop */
  },
  error(): void {
    /* noop */
  },
};

/**
 * Resolve the logger to use for a given configuration.
 *
 * Returns the injected logger when present, otherwise {@link NOOP_LOGGER}.
 */
export function resolveLogger(logger?: Logger | null): Logger {
  return logger ?? NOOP_LOGGER;
}
