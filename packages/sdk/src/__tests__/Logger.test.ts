/**
 * Tests for the observability API (#237): injectable logger + RPC timings.
 *
 * Covers:
 * 1. NOOP_LOGGER / resolveLogger — silent by default, zero calls.
 * 2. createRequestId — unique, prefixed ids.
 * 3. LoggingRpcClient / withRpcLogging — every RPC call emits a structured
 *    timing event (method, durationMs, ok, requestId) and results/errors
 *    pass through untouched.
 * 4. SorobanResurrect — wires the logger to state transitions + RPC calls
 *    and tags a `submitWithRestore` run with a stable requestId; produces
 *    no output when no logger is configured.
 */

import { describe, it, expect, vi } from 'vitest'
import { Networks } from '@stellar/stellar-sdk'
import {
  NOOP_LOGGER,
  resolveLogger,
  isLoggingEnabled,
  createRequestId,
  LoggingRpcClient,
  withRpcLogging,
} from '../Logger.js'
import type { ISorobanRpcClient } from '../RpcClient.js'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { Logger } from '../types.js'

function makeSpyLogger(): Logger & { calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = []
  return {
    calls,
    debug: (m, c) => void calls.push(['debug', m, c]),
    info: (m, c) => void calls.push(['info', m, c]),
    warn: (m, c) => void calls.push(['warn', m, c]),
    error: (m, c) => void calls.push(['error', m, c]),
  }
}

function makeMockRpcClient(): ISorobanRpcClient {
  return {
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getAccount: vi.fn(),
    getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Silent default
// ---------------------------------------------------------------------------

describe('NOOP_LOGGER / resolveLogger', () => {
  it('resolveLogger(undefined) returns the shared no-op logger', () => {
    expect(resolveLogger(undefined)).toBe(NOOP_LOGGER)
  })

  it('resolveLogger(logger) returns the supplied logger', () => {
    const logger = makeSpyLogger()
    expect(resolveLogger(logger)).toBe(logger)
  })

  it('isLoggingEnabled is false for undefined and the no-op logger', () => {
    expect(isLoggingEnabled(undefined)).toBe(false)
    expect(isLoggingEnabled(NOOP_LOGGER)).toBe(false)
    expect(isLoggingEnabled(makeSpyLogger())).toBe(true)
  })

  it('NOOP_LOGGER methods do nothing and never throw', () => {
    expect(() => {
      NOOP_LOGGER.debug('x', { a: 1 })
      NOOP_LOGGER.info('x')
      NOOP_LOGGER.warn('x')
      NOOP_LOGGER.error('x')
    }).not.toThrow()
  })
})

describe('createRequestId', () => {
  it('produces unique, prefixed ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createRequestId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^req_[a-z0-9]+_\d+$/)
  })
})

// ---------------------------------------------------------------------------
// RPC timing wrapper
// ---------------------------------------------------------------------------

describe('LoggingRpcClient / withRpcLogging', () => {
  it('withRpcLogging returns the delegate untouched when logging is disabled', () => {
    const delegate = makeMockRpcClient()
    expect(withRpcLogging(delegate, undefined)).toBe(delegate)
    expect(withRpcLogging(delegate, NOOP_LOGGER)).toBe(delegate)
  })

  it('emits a structured timing event on a successful call and returns the value', async () => {
    const delegate = makeMockRpcClient()
    vi.mocked(delegate.getLatestLedger).mockResolvedValue({ sequence: 42 } as never)
    const logger = makeSpyLogger()

    const client = new LoggingRpcClient(delegate, logger, () => 'req_test')
    const result = await client.getLatestLedger()

    expect(result).toEqual({ sequence: 42 })
    expect(logger.calls).toHaveLength(1)
    const [level, message, context] = logger.calls[0]
    expect(level).toBe('debug')
    expect(message).toMatch(/^rpc getLatestLedger ok \(\d/)
    expect(context).toMatchObject({
      method: 'getLatestLedger',
      ok: true,
      requestId: 'req_test',
    })
    expect(typeof (context as { durationMs: number }).durationMs).toBe('number')
  })

  it('emits an error timing event and re-throws the original error', async () => {
    const delegate = makeMockRpcClient()
    const boom = new Error('rpc down')
    vi.mocked(delegate.simulateTransaction).mockRejectedValue(boom)
    const logger = makeSpyLogger()

    const client = withRpcLogging(delegate, logger)
    await expect(client.simulateTransaction({} as never)).rejects.toThrow('rpc down')

    expect(logger.calls).toHaveLength(1)
    const [level, message, context] = logger.calls[0]
    expect(level).toBe('debug')
    expect(message).toMatch(/^rpc simulateTransaction error/)
    expect(context).toMatchObject({ method: 'simulateTransaction', ok: false, error: 'rpc down' })
  })

  it('forwards arguments to the delegate', async () => {
    const delegate = makeMockRpcClient()
    vi.mocked(delegate.getTransaction).mockResolvedValue({ status: 'SUCCESS' } as never)
    const client = withRpcLogging(delegate, makeSpyLogger())

    await client.getTransaction('deadbeef')
    expect(delegate.getTransaction).toHaveBeenCalledWith('deadbeef')
  })
})

// ---------------------------------------------------------------------------
// SorobanResurrect integration
// ---------------------------------------------------------------------------

const testConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
}

describe('SorobanResurrect — logger wiring', () => {
  it('defaults to the silent no-op logger when config.logger is omitted', () => {
    const sdk = new SorobanResurrect(testConfig)
    expect(sdk.logger).toBe(NOOP_LOGGER)
  })

  it('logs state transitions through the injected logger', () => {
    const logger = makeSpyLogger()
    const sdk = new SorobanResurrect({ ...testConfig, logger })

    sdk.reset() // idle → idle transition, still emitted

    const stateLines = logger.calls.filter(([, m]) => m.startsWith('state → '))
    expect(stateLines.length).toBeGreaterThan(0)
    expect(stateLines[0][0]).toBe('debug')
  })

  it('wraps the RPC client in a LoggingRpcClient when a logger is configured', () => {
    const sdk = new SorobanResurrect({ ...testConfig, logger: makeSpyLogger() })
    expect(sdk.server).toBeInstanceOf(LoggingRpcClient)
  })

  it('leaves the RPC client unwrapped when no logger is configured', () => {
    const sdk = new SorobanResurrect(testConfig)
    expect(sdk.server).not.toBeInstanceOf(LoggingRpcClient)
  })
})
