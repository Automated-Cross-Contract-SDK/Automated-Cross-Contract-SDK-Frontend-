import { describe, expect, it } from 'vitest'
import { Networks } from '@stellar/stellar-sdk'
import { getEffectiveConfig, validateConfigShape } from '../SorobanResurrectConfig.js'
import { resolveSubmitConfig } from '../RequestConfigOverrides.js'

const rpcUrl = 'https://soroban-testnet.stellar.org'

describe('configuration resolution', () => {
  it('returns effective settings and defaults without runtime resources', () => {
    const settings = getEffectiveConfig({ rpcUrl })

    expect(settings).toMatchObject({
      rpcUrl,
      networkPassphrase: Networks.TESTNET,
      pollIntervalMs: 1000,
      pollTimeoutMs: 60_000,
      restoreFeeMultiplier: 3,
      maxRestoreFeeStroops: 10_000_000,
      maxSequenceRetries: 3,
      archiveDetectionChunkSize: 50,
      archiveDetectionConcurrency: 4,
    })
    expect(settings).not.toHaveProperty('rpcClient')
    expect(Object.isFrozen(settings)).toBe(true)
  })

  it.each([
    ['rpcUrl', { rpcUrl: 'ftp://rpc.example.com' }],
    ['pollTimeoutMs', { rpcUrl, pollTimeoutMs: 0 }],
    ['rpcTimeoutMs', { rpcUrl, rpcTimeoutMs: Number.POSITIVE_INFINITY }],
    ['maxRestoreFeeStroops', { rpcUrl, maxRestoreFeeStroops: '1.5' }],
    ['restoreFeeMultiplier', { rpcUrl, restoreFeeMultiplier: 0.5 }],
    ['archiveDetectionFallback', { rpcUrl, archiveDetectionMethod: 'direct', archiveDetectionFallback: true }],
  ])('rejects invalid %s with a field-specific error', (_field, config) => {
    expect(() => validateConfigShape(config as never)).toThrow(`config.${_field}`)
  })

  it('accepts decimal integer fee caps larger than Number.MAX_SAFE_INTEGER', () => {
    expect(() =>
      validateConfigShape({
        rpcUrl,
        maxRestoreFeeStroops: '9007199254740993',
      } as never),
    ).not.toThrow()
  })
})

describe('request-specific configuration overrides', () => {
  const baseConfig = {
    rpcUrl,
    pollIntervalMs: 1000,
    pollTimeoutMs: 60_000,
    restoreFeeMultiplier: 3,
    restoreTxMemoText: '',
  }

  it('returns a frozen per-request snapshot without changing the base config', () => {
    const effective = resolveSubmitConfig(baseConfig as never, {
      configOverrides: {
        pollTimeoutMs: 12_000,
        restoreFeeMultiplier: 7,
        restoreTxMemoText: 'one request only',
      },
    })

    expect(effective.pollTimeoutMs).toBe(12_000)
    expect(effective.restoreFeeMultiplier).toBe(7)
    expect(effective.restoreTxMemoText).toBe('one request only')
    expect(baseConfig.pollTimeoutMs).toBe(60_000)
    expect(baseConfig.restoreFeeMultiplier).toBe(3)
    expect(Object.isFrozen(effective)).toBe(true)
  })

  it('preserves legacy top-level memo precedence and validates overrides', () => {
    const effective = resolveSubmitConfig(
      { rpcUrl, restoreTxMemoText: 'instance' } as never,
      {
        configOverrides: { restoreTxMemoText: 'nested' },
        restoreTxMemoText: 'legacy',
      },
    )

    expect(effective.restoreTxMemoText).toBe('legacy')
    expect(() =>
      resolveSubmitConfig(baseConfig as never, {
        configOverrides: { pollTimeoutMs: 0 },
      }),
    ).toThrow('Invalid config.pollTimeoutMs')
    expect(() =>
      resolveSubmitConfig(baseConfig as never, {
        configOverrides: { rpcUrl: 'https://attacker.example.com' } as never,
      }),
    ).toThrow('Invalid configOverrides.rpcUrl')
  })
})
