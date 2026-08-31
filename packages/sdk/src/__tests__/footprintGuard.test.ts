import { describe, it, expect, vi, afterEach } from 'vitest'
import { Account, Keypair, Networks, rpc, SorobanDataBuilder } from '@stellar/stellar-sdk'
import {
  estimateRestoreTxSizeBytes,
  evaluateRestoreFootprint,
  restoreSizeGuidance,
} from '../footprintGuard.js'
import { buildRestoreTransaction } from '../Restorer.js'
import { SOROBAN_MAX_TX_XDR_BYTES, RESTORE_TX_SIZE_WARN_RATIO } from '../constants.js'
import type { SorobanResurrectConfig } from '../types.js'

describe('evaluateRestoreFootprint — estimation math', () => {
  it('computes sizeRatio as sizeBytes / maxSizeBytes', () => {
    const d = evaluateRestoreFootprint(32 * 1024, 500, { maxSizeBytes: 128 * 1024 })
    expect(d.sizeRatio).toBeCloseTo(0.25, 10)
    expect(d.maxSizeBytes).toBe(128 * 1024)
    expect(d.estimatedSizeBytes).toBe(32 * 1024)
    expect(d.estimatedResourceFee).toBe(500)
  })

  it('defaults maxSizeBytes and warnRatio to the Soroban constants', () => {
    const d = evaluateRestoreFootprint(1000, 0)
    expect(d.maxSizeBytes).toBe(SOROBAN_MAX_TX_XDR_BYTES)
    expect(d.warnRatio).toBe(RESTORE_TX_SIZE_WARN_RATIO)
  })

  it('does not flag approachingLimit below the warn ratio', () => {
    const max = 1000
    const d = evaluateRestoreFootprint(799, 0, { maxSizeBytes: max, warnRatio: 0.8 })
    expect(d.approachingLimit).toBe(false)
    expect(d.exceedsLimit).toBe(false)
  })

  it('flags approachingLimit exactly at the warn ratio boundary', () => {
    const d = evaluateRestoreFootprint(800, 0, { maxSizeBytes: 1000, warnRatio: 0.8 })
    expect(d.sizeRatio).toBe(0.8)
    expect(d.approachingLimit).toBe(true)
    expect(d.exceedsLimit).toBe(false)
  })

  it('flags exceedsLimit only when strictly over the max', () => {
    expect(evaluateRestoreFootprint(1000, 0, { maxSizeBytes: 1000 }).exceedsLimit).toBe(false)
    expect(evaluateRestoreFootprint(1001, 0, { maxSizeBytes: 1000 }).exceedsLimit).toBe(true)
    // over-limit implies approaching-limit
    expect(evaluateRestoreFootprint(1001, 0, { maxSizeBytes: 1000 }).approachingLimit).toBe(true)
  })

  it('clamps an out-of-range warnRatio into [0, 1]', () => {
    expect(evaluateRestoreFootprint(1, 0, { maxSizeBytes: 100, warnRatio: 5 }).warnRatio).toBe(1)
    expect(evaluateRestoreFootprint(1, 0, { maxSizeBytes: 100, warnRatio: -2 }).warnRatio).toBe(0)
    // warnRatio 0 => everything is "approaching"
    expect(
      evaluateRestoreFootprint(0, 0, { maxSizeBytes: 100, warnRatio: -2 }).approachingLimit,
    ).toBe(true)
  })

  it('treats a non-positive maxSizeBytes as an infinite ratio (always flagged)', () => {
    const d = evaluateRestoreFootprint(10, 0, { maxSizeBytes: 0 })
    expect(d.sizeRatio).toBe(Infinity)
    expect(d.approachingLimit).toBe(true)
  })

  it('restoreSizeGuidance mentions the size, the limit and batching', () => {
    const msg = restoreSizeGuidance(
      evaluateRestoreFootprint(120 * 1024, 0, { maxSizeBytes: 128 * 1024 }),
    )
    expect(msg).toContain(String(120 * 1024))
    expect(msg).toContain(String(128 * 1024))
    expect(msg.toLowerCase()).toContain('batch')
  })
})

// ---------------------------------------------------------------------------

function makeMockServer(): rpc.Server {
  return { getAccount: vi.fn() } as unknown as rpc.Server
}

const baseConfig: SorobanResurrectConfig = {
  rpcUrl: 'https://test',
  networkPassphrase: Networks.TESTNET,
}

async function build(config: SorobanResurrectConfig) {
  const server = makeMockServer()
  const kp = Keypair.random()
  const account = new Account(kp.publicKey(), '1')
  vi.mocked(server.getAccount).mockResolvedValue(account as never)
  return buildRestoreTransaction({
    server,
    sourcePublicKey: kp.publicKey(),
    transactionData: new SorobanDataBuilder().build(),
    minResourceFee: 12345,
    config,
    account,
  })
}

describe('buildRestoreTransaction — footprint-size guard integration', () => {
  afterEach(() => vi.restoreAllMocks())

  it('attaches restoreDiagnostics (non-enumerable) with size + fee', async () => {
    const tx = await build(baseConfig)
    expect(tx.restoreDiagnostics).toBeDefined()
    expect(tx.restoreDiagnostics.estimatedResourceFee).toBe(12345)
    expect(tx.restoreDiagnostics.estimatedSizeBytes).toBe(estimateRestoreTxSizeBytes(tx))
    expect(tx.restoreDiagnostics.estimatedSizeBytes).toBeGreaterThan(0)
    expect(Object.keys(tx)).not.toContain('restoreDiagnostics')
  })

  it('does not warn for a small restore transaction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await build(baseConfig)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns (guidance to batch) when the configured threshold is tiny', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tx = await build({ ...baseConfig, maxRestoreTxSizeBytes: 32, restoreSizeWarnRatio: 0.5 })
    expect(tx.restoreDiagnostics.approachingLimit).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0]).toLowerCase()).toContain('batch')
  })

  it('throws instead of warning when throwOnRestoreSizeLimit is set and the limit is exceeded', async () => {
    await expect(
      build({ ...baseConfig, maxRestoreTxSizeBytes: 16, throwOnRestoreSizeLimit: true }),
    ).rejects.toThrow(/Soroban limit/i)
  })
})
