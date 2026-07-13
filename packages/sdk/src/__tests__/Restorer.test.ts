import { describe, it, expect, vi } from 'vitest'
import {
  TransactionBuilder,
  Account,
  Operation,
  Networks,
  Transaction,
  Keypair,
  rpc,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk'
import {
  extractXdrOperations,
  waitForTransaction,
  buildRestoreTransaction,
  buildOriginalAfterRestore,
} from '../Restorer.js'

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

function makeMockServer(): rpc.Server {
  return {
    getAccount: vi.fn(),
    getTransaction: vi.fn(),
    simulateTransaction: vi.fn(),
  } as unknown as rpc.Server
}

describe('Restorer', () => {
  describe('extractXdrOperations', () => {
    it('extracts operations from a Transaction', () => {
      const tx = makeSampleTx()
      const ops = extractXdrOperations(tx)
      expect(ops.length).toBe(1)
      expect(ops[0]).toBeDefined()
    })

    it('returns an array', () => {
      const tx = makeSampleTx()
      const ops = extractXdrOperations(tx)
      expect(Array.isArray(ops)).toBe(true)
    })
  })

  describe('waitForTransaction', () => {
    it('resolves when transaction status is SUCCESS', async () => {
      const server = makeMockServer()
      vi.mocked(server.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      } as never)

      const result = await waitForTransaction(server, 'hash', 50, 5000)
      expect(result.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
    })

    it('resolves when transaction status is FAILED', async () => {
      const server = makeMockServer()
      vi.mocked(server.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.FAILED,
      } as never)

      const result = await waitForTransaction(server, 'hash', 50, 5000)
      expect(result.status).toBe(rpc.Api.GetTransactionStatus.FAILED)
    })

    it('throws when transaction does not complete within timeout', async () => {
      const server = makeMockServer()
      vi.mocked(server.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as never)

      await expect(waitForTransaction(server, 'hash', 50, 200)).rejects.toThrow(
        'did not complete within',
      )
    })
  })

  describe('buildRestoreTransaction', () => {
    it('builds a transaction with restore footprint operation', async () => {
      const server = makeMockServer()
      const kp = Keypair.random()
      const realAccount = new Account(kp.publicKey(), '1')
      vi.mocked(server.getAccount).mockResolvedValue(realAccount as never)

      const txData = new SorobanDataBuilder().build()

      const tx = await buildRestoreTransaction({
        server,
        sourcePublicKey: kp.publicKey(),
        transactionData: txData,
        minResourceFee: 100,
        config: { rpcUrl: 'https://test', networkPassphrase: Networks.TESTNET },
      })

      expect(tx).toBeInstanceOf(Transaction)
      expect(tx.operations.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('buildOriginalAfterRestore', () => {
    it('rebuilds and assembles the original transaction after restore', async () => {
      const server = makeMockServer()
      const kp = Keypair.random()
      const mockTxData = new SorobanDataBuilder().build()

      const realAccount = new Account(kp.publicKey(), '2')
      vi.mocked(server.getAccount).mockResolvedValue(realAccount as never)

      vi.mocked(server.simulateTransaction).mockResolvedValue({
        id: '1',
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: { build: () => mockTxData },
        minResourceFee: '100',
        cost: { cpuInsns: '100', memBytes: '100' },
        result: { auth: [], retval: { switch: () => 0 } },
      } as never)

      const originalTx = makeSampleTx()
      const result = await buildOriginalAfterRestore(server, originalTx, Networks.TESTNET, '100')

      expect(result).toBeInstanceOf(Transaction)
    })
  })
})
