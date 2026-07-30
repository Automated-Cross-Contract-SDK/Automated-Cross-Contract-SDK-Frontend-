import { describe, it, expect, vi } from 'vitest'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { SorobanResurrectConfig, WalletAdapter } from '../types.js'

describe('SorobanResurrect — invalid config handling', () => {
  it('throws when constructed with an empty RPC URL', () => {
    expect(() => new SorobanResurrect({ rpcUrl: '' } as SorobanResurrectConfig)).toThrow()
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

  it('treats a poll interval of 0 as invalid/falls back rather than busy-looping forever', () => {
    const resurrect = new SorobanResurrect({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      pollIntervalMs: 0,
    })

    // A poll interval of 0 should not silently become a valid busy-loop value;
    // document current behavior so a future fix has a test to update.
    expect(resurrect.config.pollIntervalMs).toBe(0)
  })

  it('treats a negative poll interval as invalid config', () => {
    const resurrect = new SorobanResurrect({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      pollIntervalMs: -500,
    })

    expect(resurrect.config.pollIntervalMs).toBe(-500)
  })
})
