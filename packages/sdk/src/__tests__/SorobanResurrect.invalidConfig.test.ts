import { describe, it, expect, vi } from 'vitest'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { SorobanResurrectConfig, WalletAdapter } from '../types.js'
import { InvalidInputError, ResurrectErrorCode } from '../errors.js'

describe('SorobanResurrect — invalid config handling', () => {
  it('throws when constructed with an empty RPC URL', () => {
    expect(() => new SorobanResurrect({ rpcUrl: '' } as SorobanResurrectConfig)).toThrow(
      'Invalid config.rpcUrl',
    )
  })

  it('throws a descriptive error for an invalid RPC URL', () => {
    expect(() => new SorobanResurrect({ rpcUrl: 'not-a-url' })).toThrow(
      'Invalid config.rpcUrl',
    )
  })

  it('rejects non-HTTP RPC URLs', () => {
    expect(() => new SorobanResurrect({ rpcUrl: 'ftp://rpc.example.com' })).toThrow(
      'Invalid config.rpcUrl',
    )
  })

  it('throws when constructed with an invalid/unrecognized network passphrase', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      () =>
        new SorobanResurrect({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          networkPassphrase: 'not a real passphrase',
        }),
    ).toThrow(/Invalid config\.networkPassphrase/)
    warnSpy.mockRestore()
  })

  it('rejects submitWithRestore when no wallet adapter is provided', async () => {
    const resurrect = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })
    vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 1,
      events: [],
      _parsed: true,
      error: 'n/a',
    } as never)

    await expect(
      resurrect.submitWithRestore({
        transaction: undefined as never,
        wallet: undefined as unknown as WalletAdapter,
      }),
    ).rejects.toThrow()
  })

  it('rejects submitWithRestore with a descriptive wallet validation error', async () => {
    const resurrect = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

    await expect(
      resurrect.submitWithRestore({
        transaction: undefined as never,
        wallet: undefined as unknown as WalletAdapter,
      }),
    ).rejects.toThrow('submitWithRestore options.transaction must be a Stellar Transaction')
  })

  it('throws when a poll interval is not greater than zero', () => {
    expect(() =>
      new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        pollIntervalMs: 0,
      }),
    ).toThrow('Invalid config.pollIntervalMs')
  })

  it.each([
    ['pollTimeoutMs', 0],
    ['rpcTimeoutMs', Number.POSITIVE_INFINITY],
    ['ttlWatchIntervalMs', -1],
    ['rpcRetryCount', 1.5],
    ['rpcRetryBackoffMs', -1],
    ['rpcCircuitBreakerThreshold', 0],
    ['rpcCircuitBreakerCooldownMs', -1],
    ['ttlWatchThreshold', -1],
    ['maxSequenceRetries', -1],
    ['archiveDetectionChunkSize', 0],
    ['archiveDetectionConcurrency', 1.5],
    ['simulationCacheTtlMs', 0],
    ['simulationCacheMaxSize', 0],
    ['maxRestoreTxSizeBytes', 1.5],
    ['restoreSizeWarnRatio', 1.1],
  ])('identifies invalid timing or retry field %s', (field, value) => {
    expect(
      () =>
        new SorobanResurrect({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          [field]: value,
        } as SorobanResurrectConfig),
    ).toThrow(`config.${field}`)
  })

  it('throws when the restore fee multiplier is below one', () => {
    expect(() =>
      new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        restoreFeeMultiplier: 0.5,
      }),
    ).toThrow('Invalid config.restoreFeeMultiplier')
  })

  it.each([-1, 1.5, '1.2', ''])('rejects an invalid restore-fee cap %s', (maxRestoreFeeStroops) => {
    expect(
      () =>
        new SorobanResurrect({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          maxRestoreFeeStroops,
        } as SorobanResurrectConfig),
    ).toThrow('config.maxRestoreFeeStroops')
  })

  it('accepts decimal integer strings for large restore-fee caps', () => {
    expect(
      () =>
        new SorobanResurrect({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          maxRestoreFeeStroops: '9007199254740993',
        } as SorobanResurrectConfig),
    ).not.toThrow()
  })

  it('rejects the fallback option when direct archive detection is selected', () => {
    expect(
      () =>
        new SorobanResurrect({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          archiveDetectionMethod: 'direct',
          archiveDetectionFallback: true,
        } as SorobanResurrectConfig),
    ).toThrow('config.archiveDetectionFallback')
  })

  it('throws a typed INVALID_INPUT error for invalid configuration', () => {
    try {
      new SorobanResurrect({ rpcUrl: '' } as SorobanResurrectConfig)
      throw new Error('expected constructor to reject the invalid URL')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidInputError)
      expect((error as InvalidInputError).code).toBe(ResurrectErrorCode.INVALID_INPUT)
    }
  })

  it('rejects incomplete injected runtime primitives with INVALID_INPUT', () => {
    expect(
      () =>
        new SorobanResurrect({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          runtime: { now: () => 1 } as never,
        }),
    ).toThrow(InvalidInputError)
  })
})
