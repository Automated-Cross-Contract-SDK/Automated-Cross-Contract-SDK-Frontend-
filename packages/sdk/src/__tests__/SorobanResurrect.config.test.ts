import { describe, it, expect, vi } from 'vitest'
import { SorobanResurrect } from '../SorobanResurrect.js'
import {
  Account,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  Operation,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk'
import type { SorobanResurrectConfig } from '../types.js'
import { RESTORE_FEE_MULTIPLIER, KNOWN_NETWORK_PASSPHRASES } from '../constants.js'

function makeSampleTx(): Transaction {
  const kp = Keypair.random()
  const account = new Account(kp.publicKey(), '1')
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
}

describe('SorobanResurrect — config change reactivity', () => {
  describe('config snapshot isolation', () => {
    it('is not affected by mutating the config object passed to the constructor after construction', () => {
      const inputConfig: SorobanResurrectConfig = {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        pollIntervalMs: 500,
      }

      const resurrect = new SorobanResurrect(inputConfig)
      expect(resurrect.config.pollIntervalMs).toBe(500)

      inputConfig.pollIntervalMs = 999
      inputConfig.rpcUrl = 'https://mutated.example.com'

      expect(resurrect.config.pollIntervalMs).toBe(500)
      expect(resurrect.config.rpcUrl).toBe('https://soroban-testnet.stellar.org')
    })

    it('keeps independent config between two separate instances (no shared/static state)', () => {
      const a = new SorobanResurrect({
        rpcUrl: 'https://a.example.com',
        pollIntervalMs: 111,
        restoreFeeMultiplier: 5,
      })
      const b = new SorobanResurrect({
        rpcUrl: 'https://b.example.com',
        pollIntervalMs: 222,
        restoreFeeMultiplier: 10,
      })

      expect(a.config.rpcUrl).toBe('https://a.example.com')
      expect(a.config.pollIntervalMs).toBe(111)
      expect(a.config.restoreFeeMultiplier).toBe(5)

      expect(b.config.rpcUrl).toBe('https://b.example.com')
      expect(b.config.pollIntervalMs).toBe(222)
      expect(b.config.restoreFeeMultiplier).toBe(10)
    })
  })

  describe('config stability across the instance lifecycle', () => {
    it('leaves config untouched by state-changing operations like reset()', () => {
      const resurrect = new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        pollTimeoutMs: 12_345,
      })

      const configBefore = { ...resurrect.config }
      resurrect.reset()

      expect(resurrect.config).toEqual(configBefore)
    })

    it('leaves config untouched after a failed simulate() call', async () => {
      const resurrect = new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        restoreFeeMultiplier: 42,
      })

      vi.spyOn(resurrect.server, 'simulateTransaction').mockRejectedValue(new Error('network down'))

      const configBefore = { ...resurrect.config }
      await expect(resurrect.simulate(makeSampleTx())).rejects.toThrow('network down')

      expect(resurrect.config).toEqual(configBefore)
    })
  })

  describe('explicit config values are honored, not silently defaulted', () => {
    it('resolves every optional field to the explicitly provided value', () => {
      const resurrect = new SorobanResurrect({
        rpcUrl: 'https://custom.example.com',
        networkPassphrase: Networks.PUBLIC,
        pollIntervalMs: 250,
        pollTimeoutMs: 30_000,
        restoreFeeMultiplier: 7,
        archiveDetectionMethod: 'direct',
      })

      expect(resurrect.config).toEqual({
        rpcUrl: 'https://custom.example.com',
        networkPassphrase: Networks.PUBLIC,
        pollIntervalMs: 250,
        pollTimeoutMs: 30_000,
        restoreFeeMultiplier: 7,
        archiveDetectionMethod: 'direct',
      })
    })
  })

  describe('network passphrase validation reactivity', () => {
    it('warns when constructed with an unrecognized network passphrase', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Some Made Up Network ; 2024',
      })

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown network passphrase'))
      warnSpy.mockRestore()
    })

    it.each(KNOWN_NETWORK_PASSPHRASES)('does not warn for known network passphrase %s', (passphrase) => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: passphrase,
      })

      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('reactivity to config mutated after initialization', () => {
    it('reflects a post-construction change to restoreFeeMultiplier in subsequent buildRestoreTx calls', async () => {
      const resurrect = new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
      })
      expect(resurrect.config.restoreFeeMultiplier).toBe(RESTORE_FEE_MULTIPLIER)

      const account = new Account(Keypair.random().publicKey(), '1')
      vi.spyOn(resurrect.server, 'getAccount').mockResolvedValue(account as never)

      const mockKey = { toXDR: () => 'base64-key' }
      const mockSorobanData = new SorobanDataBuilder().build()
      const simulationResponse = {
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: {
          build: () => mockSorobanData,
          getFootprint: () => ({ readOnly: () => [], readWrite: () => [mockKey] }),
        },
        minResourceFee: '10',
        cost: { cpuInsns: '100', memBytes: '100' },
        result: { auth: [], retval: { switch: () => 0 } },
        restorePreamble: {
          minResourceFee: '10',
          transactionData: { build: () => mockSorobanData },
        },
      }

      const txWithDefaultMultiplier = await resurrect.buildRestoreTx(
        Keypair.random().publicKey(),
        makeSampleTx(),
        simulationResponse as never,
      )
      expect(txWithDefaultMultiplier.fee).toBe((10 * RESTORE_FEE_MULTIPLIER).toString())

      // Mutate config after initialization — the class currently has no
      // guard preventing this, and reads `this.config` fresh on every call.
      ;(resurrect.config as { restoreFeeMultiplier: number }).restoreFeeMultiplier = 3

      const txWithMutatedMultiplier = await resurrect.buildRestoreTx(
        Keypair.random().publicKey(),
        makeSampleTx(),
        simulationResponse as never,
      )
      expect(txWithMutatedMultiplier.fee).toBe('30')
    })
  })
})
