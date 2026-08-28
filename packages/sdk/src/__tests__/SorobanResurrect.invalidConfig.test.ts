import { describe, it, expect, vi } from 'vitest'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { SorobanResurrectConfig, WalletAdapter } from '../types.js'

describe('SorobanResurrect — invalid config handling', () => {
  it('throws when constructed with an empty RPC URL', () => {
    expect(() => new SorobanResurrect({ rpcUrl: '' } as SorobanResurrectConfig)).toThrow(
      'config.rpcUrl must be a non-empty string',
    )
  })

  it('throws a descriptive error for an invalid RPC URL', () => {
    expect(() => new SorobanResurrect({ rpcUrl: 'not-a-url' })).toThrow(
      'config.rpcUrl must be a valid URL',
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
    ).toThrow(/Invalid network passphrase/)
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
    ).toThrow('config.pollIntervalMs must be a finite number greater than 0')
  })

  it('throws when the restore fee multiplier is below one', () => {
    expect(() =>
      new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        restoreFeeMultiplier: 0.5,
      }),
    ).toThrow('config.restoreFeeMultiplier must be a finite number greater than or equal to 1')
  })
})
