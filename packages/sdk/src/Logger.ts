/**
 * @file Logger.ts
 *
 * Observability primitives for the Soroban-Resurrect SDK (#237).
 *
 * The SDK ships with **no** logging by default. Integrators opt in by
 * passing `config.logger` — a `{ debug, info, warn, error }` sink. When
 * no logger is configured the SDK never builds a log string or calls a
 * sink, so the feature has zero runtime cost.
 *
 * This module provides:
 *
 * - {@link NOOP_LOGGER} — the silent default.
 * - {@link resolveLogger} — normalises `logger | undefined` to a `Logger`.
 * - {@link createRequestId} — a short correlation id, one per
 *   `submitWithRestore` call, threaded through every log line.
 * - {@link LoggingRpcClient} / {@link withRpcLogging} — wraps any
 *   {@link ISorobanRpcClient} so each RPC round-trip emits a structured
 *   {@link RpcTimingEvent} via `logger.debug` (method + duration + id).
 *
 * @example
 * ```ts
 * import { SorobanResurrect } from '@soroban-resurrect/sdk'
 *
 * const sdk = new SorobanResurrect({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   logger: {
 *     debug: (m, c) => console.debug('[soroban-resurrect]', m, c ?? ''),
 *     info:  (m, c) => console.info('[soroban-resurrect]', m, c ?? ''),
 *     warn:  (m, c) => console.warn('[soroban-resurrect]', m, c ?? ''),
 *     error: (m, c) => console.error('[soroban-resurrect]', m, c ?? ''),
 *   },
 * })
 *
 * // → debug "rpc simulateTransaction ok" { method, durationMs, requestId, ok }
 * // → info  "state idle → simulating" { requestId }
 * ```
 */

import type { Logger, LogContext, RpcTimingEvent } from './types.js'
import type { ISorobanRpcClient } from './RpcClient.js'

// ---------------------------------------------------------------------------
// Silent default
// ---------------------------------------------------------------------------

/** No-op sink used whenever `config.logger` is omitted. */
export const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

/**
 * Returns `logger` when defined, otherwise {@link NOOP_LOGGER}.
 *
 * Callers can then log unconditionally; the branch on "is a logger
 * configured?" is made once, here, at construction time.
 */
export function resolveLogger(logger?: Logger): Logger {
  return logger ?? NOOP_LOGGER
}

/**
 * `true` when the supplied logger will actually do something. Use this to
 * skip expensive context construction when logging is disabled.
 */
export function isLoggingEnabled(logger: Logger | undefined): boolean {
  return logger !== undefined && logger !== NOOP_LOGGER
}

// ---------------------------------------------------------------------------
// Request correlation id
// ---------------------------------------------------------------------------

let _requestCounter = 0

/**
 * Generates a short, process-unique correlation id (e.g. `req_1a2b3c_4`).
 *
 * One id is created per `submitWithRestore` call and attached to every
 * log line the workflow produces, so interleaved logs from concurrent
 * calls can be untangled.
 */
export function createRequestId(): string {
  _requestCounter += 1
  const rand = Math.random().toString(36).slice(2, 8)
  return `req_${rand}_${_requestCounter}`
}

// ---------------------------------------------------------------------------
// RPC timing wrapper
// ---------------------------------------------------------------------------

/** Millisecond clock — `performance.now()` when available, else `Date.now()`. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

/**
 * Decorates an {@link ISorobanRpcClient} so every call is timed and
 * reported to `logger.debug` as a structured {@link RpcTimingEvent}.
 *
 * The wrapper is transparent: it forwards arguments and return values
 * unchanged, and re-throws the original error after logging it.
 *
 * @param delegate      - The underlying RPC client to wrap.
 * @param logger        - Sink for the timing events.
 * @param getRequestId  - Optional accessor for the current workflow's
 *   correlation id, evaluated per call so a single wrapper instance can
 *   serve sequential workflows.
 */
export class LoggingRpcClient implements ISorobanRpcClient {
  constructor(
    private readonly delegate: ISorobanRpcClient,
    private readonly logger: Logger,
    private readonly getRequestId?: () => string | undefined,
  ) {}

  private async timed<T>(method: string, run: () => Promise<T>): Promise<T> {
    const started = now()
    const requestId = this.getRequestId?.()
    try {
      const result = await run()
      this.emit({ method, durationMs: round(now() - started), ok: true, requestId })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({
        method,
        durationMs: round(now() - started),
        ok: false,
        requestId,
        error: message,
      })
      throw err
    }
  }

  private emit(event: RpcTimingEvent): void {
    const status = event.ok ? 'ok' : 'error'
    this.logger.debug(`rpc ${event.method} ${status} (${event.durationMs}ms)`, {
      ...event,
    } satisfies LogContext)
  }

  simulateTransaction(
    ...args: Parameters<ISorobanRpcClient['simulateTransaction']>
  ): ReturnType<ISorobanRpcClient['simulateTransaction']> {
    return this.timed('simulateTransaction', () => this.delegate.simulateTransaction(...args))
  }

  sendTransaction(
    ...args: Parameters<ISorobanRpcClient['sendTransaction']>
  ): ReturnType<ISorobanRpcClient['sendTransaction']> {
    return this.timed('sendTransaction', () => this.delegate.sendTransaction(...args))
  }

  getTransaction(
    ...args: Parameters<ISorobanRpcClient['getTransaction']>
  ): ReturnType<ISorobanRpcClient['getTransaction']> {
    return this.timed('getTransaction', () => this.delegate.getTransaction(...args))
  }

  getAccount(
    ...args: Parameters<ISorobanRpcClient['getAccount']>
  ): ReturnType<ISorobanRpcClient['getAccount']> {
    return this.timed('getAccount', () => this.delegate.getAccount(...args))
  }

  getLedgerEntries(
    ...args: Parameters<ISorobanRpcClient['getLedgerEntries']>
  ): ReturnType<ISorobanRpcClient['getLedgerEntries']> {
    return this.timed('getLedgerEntries', () => this.delegate.getLedgerEntries(...args))
  }

  getLatestLedger(
    ...args: Parameters<ISorobanRpcClient['getLatestLedger']>
  ): ReturnType<ISorobanRpcClient['getLatestLedger']> {
    return this.timed('getLatestLedger', () => this.delegate.getLatestLedger(...args))
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Wraps `delegate` in a {@link LoggingRpcClient} when `logger` is active;
 * returns `delegate` untouched when logging is disabled (zero overhead).
 */
export function withRpcLogging(
  delegate: ISorobanRpcClient,
  logger: Logger | undefined,
  getRequestId?: () => string | undefined,
): ISorobanRpcClient {
  if (!isLoggingEnabled(logger)) return delegate
  return new LoggingRpcClient(delegate, logger as Logger, getRequestId)
}
