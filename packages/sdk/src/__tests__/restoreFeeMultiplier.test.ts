import { describe, it, expect, vi } from 'vitest'
import { Account, Keypair, Networks, rpc, SorobanDataBuilder } from '@stellar/stellar-sdk'
import { buildRestoreTransaction } from '../Restorer.js'
import { RESTORE_FEE_MULTIPLIER } from '../constants.js'
import type { SorobanResurrectConfig } from '../types.js'

function makeMockServer(): rpc.Server {
  return {
    getAccount: vi.fn(),
  } as unknown as rpc.Server
}

const baseConfig: SorobanResurrectConfig = {
  rpcUrl: 'https://test',
  networkPassphrase: Networks.TESTNET,
}

async function buildFee(minResourceFee: number, config: SorobanResurrectConfig): Promise<string> {
  const server = makeMockServer()
  const kp = Keypair.random()
  const account = new Account(kp.publicKey(), '1')
  vi.mocked(server.getAccount).mockResolvedValue(account as never)

  const tx = await buildRestoreTransaction({
    server,
    sourcePublicKey: kp.publicKey(),
    transactionData: new SorobanDataBuilder().build(),
    minResourceFee,
    latestLedger: 100,
    config,
    account,
  })

  return tx.fee
}

describe('buildRestoreTransaction — RESTORE_FEE_MULTIPLIER application', () => {
  describe('base fee multiplication with the default multiplier', () => {
    it('multiplies minResourceFee by the default RESTORE_FEE_MULTIPLIER (3)', async () => {
      expect(RESTORE_FEE_MULTIPLIER).toBe(3)
      const fee = await buildFee(100, baseConfig)
      expect(fee).toBe('300')
    })

    it('scales correctly for an arbitrary base fee', async () => {
      const fee = await buildFee(1234, baseConfig)
      expect(fee).toBe((1234 * RESTORE_FEE_MULTIPLIER).toString())
      expect(fee).toBe('3702')
    })
  })

  describe('custom restoreFeeMultiplier', () => {
    it('uses a custom multiplier from config instead of the default', async () => {
      const fee = await buildFee(100, { ...baseConfig, restoreFeeMultiplier: 50 })
      expect(fee).toBe('5000')
    })

    it('applies a multiplier of 1 (no amplification)', async () => {
      const fee = await buildFee(777, { ...baseConfig, restoreFeeMultiplier: 1 })
      expect(fee).toBe('777')
    })

    it('applies a multiplier greater than the default', async () => {
      const fee = await buildFee(10, { ...baseConfig, restoreFeeMultiplier: 500 })
      expect(fee).toBe('5000')
    })
  })

  describe('edge cases with very large and very small fees', () => {
    it.each([0, 1])('never drops below the network base fee (minResourceFee %i)', async (min) => {
      expect(await buildFee(min, baseConfig)).toBe('100')
    })

    it('handles a very large minResourceFee without losing precision', async () => {
      expect(await buildFee(1_000_000_000, baseConfig)).toBe('3000000000')
    })

    it('rejects a fee above the protocol uint32 maximum', async () => {
      await expect(
        buildFee(1_000_000, { ...baseConfig, restoreFeeMultiplier: 10_000 }),
      ).rejects.toThrow(/maximum uint32/)
    })

    it('truncates a fractional fee to whole stroops', async () => {
      expect(await buildFee(333, { ...baseConfig, restoreFeeMultiplier: 1.5 })).toBe('499')
    })
  })

  describe('Soroban resource fee', () => {
    const withResourceFee = (resourceFee: string, config: SorobanResurrectConfig) =>
      buildRestoreTransaction({
        server: makeMockServer(),
        sourcePublicKey: Keypair.random().publicKey(),
        transactionData: new SorobanDataBuilder().setResourceFee(resourceFee).build(),
        minResourceFee: 1000,
        latestLedger: 100,
        config,
        account: new Account(Keypair.random().publicKey(), '1'),
      })

    it('is included in the quoted fee, not charged on top of it', async () => {
      const tx = await withResourceFee('1000', baseConfig)
      expect(tx.fee).toBe('3000')
    })

    it('never lets the built transaction exceed maxRestoreFeeStroops', async () => {
      const capped = { ...baseConfig, restoreFeeMultiplier: 1, maxRestoreFeeStroops: 1050 }
      await expect(withResourceFee('1000', capped)).rejects.toThrow()
    })
  })
})
