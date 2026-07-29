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
    config,
    account,
  })

  return tx.fee
}

describe('buildRestoreTransaction — RESTORE_FEE_MULTIPLIER application', () => {
  describe('base fee multiplication with the default multiplier', () => {
    it('multiplies minResourceFee by the default RESTORE_FEE_MULTIPLIER (100)', async () => {
      expect(RESTORE_FEE_MULTIPLIER).toBe(100)
      const fee = await buildFee(100, baseConfig)
      expect(fee).toBe('10000')
    })

    it('scales correctly for an arbitrary base fee', async () => {
      const fee = await buildFee(1234, baseConfig)
      expect(fee).toBe((1234 * RESTORE_FEE_MULTIPLIER).toString())
      expect(fee).toBe('123400')
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
    it('handles a minResourceFee of 0', async () => {
      const fee = await buildFee(0, baseConfig)
      expect(fee).toBe('0')
    })

    it('handles a minResourceFee of 1 with the default multiplier', async () => {
      const fee = await buildFee(1, baseConfig)
      expect(fee).toBe('100')
    })

    it('handles a very large minResourceFee without losing precision', async () => {
      const largeFee = 1_000_000_000
      const fee = await buildFee(largeFee, baseConfig)
      expect(fee).toBe((largeFee * RESTORE_FEE_MULTIPLIER).toString())
      expect(fee).toBe('100000000000')
      expect(Number(fee)).toBeLessThan(Number.MAX_SAFE_INTEGER)
    })

    it('handles a very large minResourceFee combined with a large custom multiplier', async () => {
      const fee = await buildFee(1_000_000, { ...baseConfig, restoreFeeMultiplier: 10_000 })
      expect(fee).toBe('10000000000')
    })

    it('truncates a fractional result the same way Number.prototype.toString does', async () => {
      // minResourceFee * a fractional multiplier can yield a non-integer;
      // buildRestoreTransaction does not round, it just stringifies the product.
      const fee = await buildFee(3, { ...baseConfig, restoreFeeMultiplier: 1.5 })
      expect(fee).toBe('4.5')
    })
  })
})
