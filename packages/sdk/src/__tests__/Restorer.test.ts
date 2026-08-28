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
  xdr,
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

    // ── Regression tests for Bug #27 ──────────────────────────────────────
    // Original bug: extractXdrOperations silently defaulted to V1 for
    // unknown envelope types instead of throwing descriptive errors.
    // Also lacked explicit handling for V0 and fee-bump envelopes.

    it('[regression #27] extracts operations from a fee-bump transaction envelope', () => {
      const innerTx = makeSampleTx()
      const sponsor = Keypair.random()
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        sponsor.publicKey(),
        '1000',
        innerTx,
        Networks.TESTNET,
      )
      // FeeBumpTransaction extends Transaction, so this compiles
      const ops = extractXdrOperations(feeBumpTx as unknown as Transaction)
      expect(ops.length).toBe(1)
      expect(ops[0]).toBeDefined()
    })

    it('[regression #27] extracts operations from a V0 transaction envelope', () => {
      const kp = Keypair.random()

      // Build a normal V1 transaction to get a valid xdr.Operation array,
      // then wrap those operations in a V0 envelope.
      const helperTx = makeSampleTx()
      const helperEnvelope = helperTx.toEnvelope()
      const helperV1Env = helperEnvelope.value() as xdr.TransactionV1Envelope
      const operations = helperV1Env.tx().operations()

      const v0TxBody = new xdr.TransactionV0({
        sourceAccountEd25519: kp.rawPublicKey(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fee: 100 as unknown as any,
        seqNum: BigInt(1) as unknown as xdr.Int64,
        timeBounds: new xdr.TimeBounds({
          minTime: BigInt(0) as unknown as xdr.Uint64,
          maxTime: BigInt(0) as unknown as xdr.Uint64,
        }),
        memo: xdr.Memo.memoNone(),
        operations,
        ext: 0 as unknown as xdr.TransactionExt,
      })

      const v0Envelope = new xdr.TransactionV0Envelope({
        tx: v0TxBody,
        signatures: [],
      })

      const txEnv = xdr.TransactionEnvelope.envelopeTypeTxV0(v0Envelope)

      // Create a Transaction but mock toEnvelope() to return our V0 envelope
      // directly, since the Transaction class may not reconstruct V0 properly.
      const v0Tx = new Transaction(txEnv, Networks.TESTNET)
      vi.spyOn(v0Tx, 'toEnvelope').mockReturnValue(txEnv)

      const ops = extractXdrOperations(v0Tx)
      expect(ops.length).toBe(1)
    })

    it('[regression #27] throws descriptive error on unknown envelope type', () => {
      const tx = makeSampleTx()
      // Mock toEnvelope to return an unknown switch type
      vi.spyOn(tx, 'toEnvelope').mockReturnValue({
        switch: () => ({ name: 'envelopeTypeUnknown42' }),
        value: () => ({}),
      } as any)

      expect(() => extractXdrOperations(tx)).toThrow(
        'Unsupported transaction envelope type: envelopeTypeUnknown42',
      )
    })

    it('[regression #27] throws descriptive error on unsupported inner envelope type in fee-bump', () => {
      const tx = makeSampleTx()
      // Mock toEnvelope to return a fee-bump envelope with an unsupported inner type
      const fakeInnerEnvelope = {
        switch: () => ({ name: 'envelopeTypeUnknownInner99' }),
      }

      vi.spyOn(tx, 'toEnvelope').mockReturnValue({
        switch: () => ({ name: 'envelopeTypeTxFeeBump' }),
        value: () => ({
          tx: () => ({
            innerTx: () => fakeInnerEnvelope,
          }),
        }),
      } as any)

      expect(() => extractXdrOperations(tx)).toThrow(
        /Unsupported inner transaction envelope type in fee-bump/,
      )
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
