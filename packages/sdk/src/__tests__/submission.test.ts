import { describe, expect, it, vi } from 'vitest'
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  xdr,
  type rpc,
} from '@stellar/stellar-sdk'
import { executeWithRestore } from '../Executor.js'
import { isTxBadSeqError } from '../Restorer.js'
import type { WalletAdapter } from '../types.js'

const NP = Networks.TESTNET
const kp = Keypair.random()
const CONTRACT = Address.contract(new Uint8Array(32).fill(7)).toString()

function rejected(type: 'txBadSeq' | 'txSorobanInvalid') {
  return {
    status: 'ERROR',
    hash: 'a'.repeat(64),
    errorResult: new xdr.TransactionResult({
      feeCharged: 100n,
      result: xdr.TransactionResultResult[type](),
      ext: xdr.TransactionResultExt.v0(),
    }),
  } as unknown as rpc.Api.SendTransactionResponse
}

function setup(sent: unknown) {
  const transaction = new TransactionBuilder(new Account(kp.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: NP,
  })
    .addOperation(new Contract(CONTRACT).call('hello'))
    .setTimeout(30)
    .build()
  const server = {
    simulateTransaction: vi.fn().mockResolvedValue({
      _parsed: true,
      latestLedger: 1,
      minResourceFee: '5000',
      transactionData: new SorobanDataBuilder().setResourceFee('5000'),
      result: { auth: [], retval: xdr.ScVal.scvVoid() },
    }),
    sendTransaction: vi.fn().mockResolvedValue(sent),
    getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
  }
  const wallet = {
    isConnected: async () => true,
    getPublicKey: async () => kp.publicKey(),
    signTransaction: async (envelope: string) => {
      const tx = TransactionBuilder.fromXDR(envelope, NP)
      tx.sign(kp)
      return tx.toXDR()
    },
  } as unknown as WalletAdapter
  const run = () =>
    executeWithRestore({
      server: server as never,
      transaction,
      wallet,
      config: { rpcUrl: 'https://test', networkPassphrase: NP },
    })
  return { server, run }
}

describe('submission without a restore', () => {
  it('assembles the transaction with the simulated resources before signing', async () => {
    const { server, run } = setup({ status: 'PENDING', hash: 'a'.repeat(64) })
    expect(await run()).toMatchObject({ success: true })

    const submitted = server.sendTransaction.mock.calls[0][0] as Transaction
    const envelope = submitted.toEnvelope()
    if (envelope.type !== 'envelopeTypeTx') throw new Error('expected a v1 envelope')
    expect(envelope.v1.tx.ext.type).toBe('sorobanData')
    expect(submitted.fee).toBe('5100')
  })

  it('fails immediately when the network rejects the submission', async () => {
    const { server, run } = setup(rejected('txSorobanInvalid'))
    expect(await run()).toMatchObject({
      success: false,
      errorCode: 'ORIGINAL_TX_FAILED',
      error: expect.stringContaining('txSorobanInvalid'),
    })
    expect(server.getTransaction).not.toHaveBeenCalled()
  })
})

describe('isTxBadSeqError', () => {
  it('recognises the decoded RPC error result', () => {
    expect(isTxBadSeqError(rejected('txBadSeq'))).toBe(true)
    expect(isTxBadSeqError(rejected('txSorobanInvalid'))).toBe(false)
  })
})
