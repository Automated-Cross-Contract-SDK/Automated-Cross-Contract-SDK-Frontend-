import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  rpc,
  TransactionBuilder,
  Account,
  Networks,
  Operation,
  Keypair,
  Transaction,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk'
import { executeWithRestore } from '../Executor.js'
import type { WalletAdapter, SorobanResurrectConfig } from '../types.js'

function makeMockServer(): rpc.Server {
  return {
    simulateTransaction: vi.fn(),
    getAccount: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getLedgerEntries: vi.fn(),
  } as unknown as rpc.Server
}

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

function makeWallet(): WalletAdapter {
  return {
    isConnected: vi.fn().mockResolvedValue(true),
    getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
    signTransaction: vi.fn().mockImplementation(async (tx: string) => tx),
  }
}

const defaultConfig: SorobanResurrectConfig = {
  rpcUrl: 'https://testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  pollIntervalMs: 100,
  pollTimeoutMs: 5000,
}

const mockSorobanData = new SorobanDataBuilder().build()

function makeSuccessResponse() {
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: {
      build: () => mockSorobanData,
      getFootprint: () => ({ readOnly: () => [], readWrite: () => [] }),
    },
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: { switch: () => 0 } },
  }
}

function makeRestoreResponse() {
  const mockLedgerKey = { toXDR: () => 'base64-key' }
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: {
      build: () => mockSorobanData,
      getFootprint: () => ({ readOnly: () => [], readWrite: () => [mockLedgerKey] }),
    },
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: { switch: () => 0 } },
    restorePreamble: {
      minResourceFee: '100',
      transactionData: { build: () => mockSorobanData },
    },
  }
}

function makeErrorResponse() {
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    error: 'simulation failed',
  }
}

describe('executeWithRestore', () => {
  let server: rpc.Server

  beforeEach(() => {
    server = makeMockServer()
    vi.clearAllMocks()
  })

  it('returns error result when simulation fails', async () => {
    vi.mocked(server.simulateTransaction).mockResolvedValue(makeErrorResponse() as never)

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.archivedKeysDetected).toBe(0)
    expect(result.error).toContain('simulation failed')
  })

  it('submits transaction directly when simulation succeeds (no restore)', async () => {
    vi.mocked(server.simulateTransaction).mockResolvedValue(makeSuccessResponse() as never)
    vi.mocked(server.sendTransaction).mockResolvedValue({ hash: 'tx-hash-123' } as never)

    const wallet = makeWallet()
    const onOriginalSubmitted = vi.fn()

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
      onOriginalSubmitted,
    })

    expect(result.success).toBe(true)
    expect(result.originalTxHash).toBe('tx-hash-123')
    expect(result.archivedKeysDetected).toBe(0)
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1)
    expect(onOriginalSubmitted).toHaveBeenCalledWith('tx-hash-123')
  })

  it('performs full restore flow when restore is needed', async () => {
    vi.mocked(server.simulateTransaction)
      .mockResolvedValueOnce(makeRestoreResponse() as never)
      .mockResolvedValueOnce(makeSuccessResponse() as never)

    vi.mocked(server.getAccount).mockResolvedValue(
      new Account(Keypair.random().publicKey(), '2') as never,
    )

    const sendTransactionMock = vi
      .fn()
      .mockResolvedValueOnce({ hash: 'restore-hash' } as never)
      .mockResolvedValueOnce({ hash: 'original-hash' } as never)
    server.sendTransaction = sendTransactionMock

    vi.mocked(server.getTransaction).mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never)

    const wallet = makeWallet()
    const onRestoreNeeded = vi.fn()
    const onRestoreSubmitted = vi.fn()
    const onRestoreConfirmed = vi.fn()
    const onOriginalSubmitted = vi.fn()

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
      onRestoreNeeded,
      onRestoreSubmitted,
      onRestoreConfirmed,
      onOriginalSubmitted,
    })

    expect(result.success).toBe(true)
    expect(result.restoreTxHash).toBe('restore-hash')
    expect(result.originalTxHash).toBe('original-hash')
    expect(result.archivedKeysDetected).toBe(1)
    expect(onRestoreNeeded).toHaveBeenCalled()
    expect(onRestoreSubmitted).toHaveBeenCalledWith('restore-hash')
    expect(onRestoreConfirmed).toHaveBeenCalledWith('restore-hash')
    expect(onOriginalSubmitted).toHaveBeenCalledWith('original-hash')
  })

  it('returns error when signed transaction cannot be parsed', async () => {
    vi.mocked(server.simulateTransaction).mockResolvedValue(makeSuccessResponse() as never)

    const wallet = makeWallet()
    // Return an XDR string that deserializes but is not a valid Transaction
    wallet.signTransaction = vi.fn().mockResolvedValue('AAAA') // too short

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('catches unexpected errors and returns structured error', async () => {
    vi.mocked(server.simulateTransaction).mockRejectedValue(new Error('network error'))

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('network error')
  })

  it('handles unexpected simulation response type', async () => {
    vi.mocked(server.simulateTransaction).mockResolvedValue({
      id: '1',
      latestLedger: 100,
      _parsed: true,
      events: [],
    } as never)

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Unexpected simulation response type')
  })

  it('returns error when restore transaction fails on-chain', async () => {
    vi.mocked(server.simulateTransaction).mockResolvedValue(makeRestoreResponse() as never)
    vi.mocked(server.getAccount).mockResolvedValue(
      new Account(Keypair.random().publicKey(), '2') as never,
    )
    vi.mocked(server.sendTransaction).mockResolvedValue({ hash: 'restore-hash' } as never)
    vi.mocked(server.getTransaction).mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
    } as never)

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.restoreTxHash).toBe('restore-hash')
    expect(result.error).toBe('Restore transaction failed')
  })
})
