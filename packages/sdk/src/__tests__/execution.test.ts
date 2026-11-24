import { beforeEach, describe, expect, it, vi } from 'vitest'
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
} from '@stellar/stellar-sdk'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { WalletAdapter } from '../types.js'

const NP = Networks.TESTNET
const kp = Keypair.random()
const contract = Address.contract(new Uint8Array(32).fill(5))
const key = xdr.LedgerKey.contractData(
  new xdr.LedgerKeyContractData({
    contract: contract.toScAddress(),
    key: xdr.ScVal.scvU32(1),
    durability: xdr.ContractDataDurability.persistent,
  }),
)

const data = () => new SorobanDataBuilder().setReadWrite([key]).setResourceFee('1000')
const success = () => ({
  _parsed: true,
  id: '1',
  events: [],
  latestLedger: 100,
  minResourceFee: '1000',
  transactionData: data(),
  result: { auth: [], retval: xdr.ScVal.scvVoid() },
})
/** Pre-protocol-23 RPC: the restore is a separate transaction. */
const restoreNeeded = () => ({
  ...success(),
  restorePreamble: { minResourceFee: '1000', transactionData: data() },
})

function callTransaction(): Transaction {
  return new TransactionBuilder(new Account(kp.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: NP,
  })
    .addOperation(new Contract(contract.toString()).call('withdraw'))
    .setTimeout(60)
    .build()
}

let sdk: SorobanResurrect
let wallet: WalletAdapter
let sent: Transaction[]

beforeEach(() => {
  sdk = new SorobanResurrect({
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: NP,
    pollIntervalMs: 1,
  })
  sent = []
  vi.spyOn(sdk.server, 'getAccount').mockImplementation(
    async () => new Account(kp.publicKey(), '1'),
  )
  vi.spyOn(sdk.server, 'getLatestLedger').mockResolvedValue({ sequence: 100 } as never)
  vi.spyOn(sdk.server, 'getTransaction').mockResolvedValue({ status: 'SUCCESS' } as never)
  vi.spyOn(sdk.server, 'sendTransaction').mockImplementation(async (tx) => {
    sent.push(tx as Transaction)
    return { status: 'PENDING', hash: String(sent.length).padStart(64, '0') } as never
  })
  vi.spyOn(sdk.server, 'simulateTransaction').mockResolvedValue(success() as never)
  wallet = {
    isConnected: async () => true,
    getPublicKey: async () => kp.publicKey(),
    signTransaction: async (envelope: string) => envelope,
  } as unknown as WalletAdapter
})

const operationsOf = (txs: Transaction[]) => txs.map((tx) => tx.operations[0].type)

describe('restoreKeys', () => {
  it('signs, submits and confirms one restore transaction', async () => {
    const onRestoreConfirmed = vi.fn()
    const result = await sdk.restoreKeys([key], wallet, { onRestoreConfirmed })
    expect(result).toMatchObject({ success: true, archivedKeysDetected: 1 })
    expect(operationsOf(sent)).toEqual(['restoreFootprint'])
    expect(sent[0].fee).toBe('3000')
    expect(onRestoreConfirmed).toHaveBeenCalledWith(result.restoreTxHash)
    expect(sdk.state).toBe('success')
  })

  it('reports an empty key list, a rejection and an on-chain failure', async () => {
    expect((await sdk.restoreKeys([], wallet)).error).toContain('at least one ledger key')

    vi.mocked(sdk.server.sendTransaction).mockResolvedValueOnce({
      status: 'TRY_AGAIN_LATER',
      hash: 'a'.repeat(64),
    } as never)
    expect(await sdk.restoreKeys([key], wallet)).toMatchObject({
      success: false,
      errorCode: 'RESTORE_TX_FAILED',
    })

    vi.mocked(sdk.server.getTransaction).mockResolvedValue({ status: 'FAILED' } as never)
    expect(await sdk.restoreKeys([key], wallet)).toMatchObject({
      success: false,
      errorCode: 'RESTORE_TX_FAILED',
    })
    expect(sdk.state).toBe('error')
  })
})

describe('separate restore (older RPCs)', () => {
  it('restores first, then rebuilds and submits the call', async () => {
    vi.mocked(sdk.server.simulateTransaction)
      .mockResolvedValueOnce(restoreNeeded() as never)
      .mockResolvedValue(success() as never)
    const result = await sdk.submitWithRestore({ transaction: callTransaction(), wallet })
    expect(result).toMatchObject({ success: true, restoreMode: 'separate' })
    expect(operationsOf(sent)).toEqual(['restoreFootprint', 'invokeHostFunction'])
    expect(sent[1].fee).toBe('1100')
  })

  it('waits for a lagging RPC, then gives up without submitting the call', async () => {
    vi.mocked(sdk.server.simulateTransaction).mockResolvedValue(restoreNeeded() as never)
    const result = await sdk.submitWithRestore({ transaction: callTransaction(), wallet })
    expect(result).toMatchObject({ success: false, errorCode: 'RESTORE_TX_FAILED' })
    expect(result.restoreTxHash).toBeDefined()
    expect(operationsOf(sent)).toEqual(['restoreFootprint'])
  })

  it('retries tx_bad_seq with a rebuilt transaction', async () => {
    vi.mocked(sdk.server.simulateTransaction)
      .mockResolvedValueOnce(restoreNeeded() as never)
      .mockResolvedValue(success() as never)
    const badSeq = {
      status: 'ERROR',
      hash: 'f'.repeat(64),
      errorResult: new xdr.TransactionResult({
        feeCharged: 100n,
        result: xdr.TransactionResultResult.txBadSeq(),
        ext: xdr.TransactionResultExt.v0(),
      }),
    }
    vi.mocked(sdk.server.sendTransaction)
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'a'.repeat(64) } as never)
      .mockResolvedValueOnce(badSeq as never)
    const result = await sdk.submitWithRestore({ transaction: callTransaction(), wallet })
    expect(result).toMatchObject({ success: true, sequenceRetries: 1 })
  })
})

describe('submitBatchWithRestore (older RPCs)', () => {
  it('shares one restore and submits every call', async () => {
    vi.mocked(sdk.server.simulateTransaction)
      .mockResolvedValueOnce(restoreNeeded() as never)
      .mockResolvedValueOnce(restoreNeeded() as never)
      .mockResolvedValue(success() as never)
    const results = await sdk.submitBatchWithRestore([
      { transaction: callTransaction(), wallet },
      { transaction: callTransaction(), wallet },
    ])
    expect(results.map((r) => [r.success, r.confirmationStatus])).toEqual([
      [true, 'submitted'],
      [true, 'submitted'],
    ])
    expect(operationsOf(sent)).toEqual([
      'restoreFootprint',
      'invokeHostFunction',
      'invokeHostFunction',
    ])
  })

  it('fails every item when the shared restore fails or the wallet is disconnected', async () => {
    vi.mocked(sdk.server.simulateTransaction).mockResolvedValue(restoreNeeded() as never)
    vi.mocked(sdk.server.getTransaction).mockResolvedValue({ status: 'FAILED' } as never)
    const items = [
      { transaction: callTransaction(), wallet },
      { transaction: callTransaction(), wallet },
    ]
    expect((await sdk.submitBatchWithRestore(items)).map((r) => r.success)).toEqual([false, false])

    wallet.isConnected = async () => false
    expect((await sdk.submitBatchWithRestore(items)).map((r) => r.error)).toEqual([
      'Wallet is not connected',
      'Wallet is not connected',
    ])
    expect(await sdk.submitBatchWithRestore([])).toEqual([])
  })
})

describe('history and retry', () => {
  it('re-runs a failed workflow and records the new result', async () => {
    vi.mocked(sdk.server.sendTransaction).mockRejectedValueOnce(new Error('fetch failed'))
    const first = await sdk.submitWithRestore({ transaction: callTransaction(), wallet })
    expect(first.success).toBe(false)
    const second = await sdk.retry(first.historyId!, wallet)
    expect(second.success).toBe(true)
    expect(sdk.history[0]).toMatchObject({ attemptCount: 2 })
    sdk.clearHistory()
    expect(sdk.history).toEqual([])
    await expect(sdk.retry('missing', wallet)).rejects.toThrow('No history entry')
  })
})
