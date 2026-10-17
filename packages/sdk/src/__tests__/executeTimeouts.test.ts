import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Account,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from '../RpcClient.js'
import type { SorobanResurrectConfig, WalletAdapter } from '../types.js'

const mocks = vi.hoisted(() => ({
  isErrorResponse: vi.fn(),
  isRestoreResponse: vi.fn(),
  isSuccessResponse: vi.fn(),
  extractArchivedKeys: vi.fn(),
  buildRestoreTransaction: vi.fn(),
  waitForTransaction: vi.fn(),
  buildOriginalAfterRestore: vi.fn(),
  buildFeeBumpTransaction: vi.fn(),
  submitFeeBumpTransaction: vi.fn(),
  isTxBadSeqError: vi.fn(),
}))

vi.mock('../Archiver.js', () => ({
  isErrorResponse: mocks.isErrorResponse,
  isRestoreResponse: mocks.isRestoreResponse,
  isSuccessResponse: mocks.isSuccessResponse,
  extractArchivedKeys: mocks.extractArchivedKeys,
}))

vi.mock('../Restorer.js', () => ({
  buildRestoreTransaction: mocks.buildRestoreTransaction,
  waitForTransaction: mocks.waitForTransaction,
  waitForTransactionSSE: mocks.waitForTransaction,
  buildOriginalAfterRestore: mocks.buildOriginalAfterRestore,
  buildFeeBumpTransaction: mocks.buildFeeBumpTransaction,
  submitFeeBumpTransaction: mocks.submitFeeBumpTransaction,
  isTxBadSeqError: mocks.isTxBadSeqError,
}))

import { executeWithRestore } from '../Executor.js'

function makeTransaction(): Transaction {
  return new TransactionBuilder(new Account(Keypair.random().publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
}

function makeSetup() {
  const publicKey = Keypair.random().publicKey()
  const server = {
    simulateTransaction: vi.fn(),
    getAccount: vi.fn().mockResolvedValue(new Account(publicKey, '1')),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  } as unknown as ISorobanRpcClient
  const wallet: WalletAdapter = {
    isConnected: vi.fn().mockResolvedValue(true),
    getPublicKey: vi.fn().mockResolvedValue(publicKey),
    signTransaction: vi.fn(async (transactionXdr: string) => transactionXdr),
  }
  const config: SorobanResurrectConfig = {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    pollIntervalMs: 1,
    pollTimeoutMs: 10_000,
    simulationTimeoutMs: 1_000,
    walletSigningTimeoutMs: 1_000,
    restoreConfirmationTimeoutMs: 1_000,
    originalSubmissionTimeoutMs: 1_000,
  }

  return { server, wallet, config }
}

function useRestoreSimulation(server: ISorobanRpcClient): void {
  vi.mocked(server.simulateTransaction).mockResolvedValue({
    transactionData: { build: () => new SorobanDataBuilder().build() },
    minResourceFee: '100',
  } as never)
  mocks.isErrorResponse.mockReturnValue(false)
  mocks.isRestoreResponse.mockReturnValue(true)
  mocks.extractArchivedKeys.mockReturnValue([])
  mocks.buildRestoreTransaction.mockResolvedValue(makeTransaction())
  mocks.buildOriginalAfterRestore.mockResolvedValue(makeTransaction())
}

describe('executeWithRestore phase timeouts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.isErrorResponse.mockReturnValue(false)
    mocks.isRestoreResponse.mockReturnValue(false)
    mocks.isSuccessResponse.mockReturnValue(false)
    mocks.extractArchivedKeys.mockReturnValue([])
    mocks.buildRestoreTransaction.mockResolvedValue(makeTransaction())
    mocks.buildOriginalAfterRestore.mockResolvedValue(makeTransaction())
    mocks.waitForTransaction.mockResolvedValue({ status: 'SUCCESS' })
    mocks.isTxBadSeqError.mockReturnValue(false)
  })

  it('times out simulation without using the confirmation timeout', async () => {
    const { server, wallet, config } = makeSetup()
    vi.mocked(server.simulateTransaction).mockImplementation(() => new Promise(() => {}))

    const result = await executeWithRestore({
      server,
      transaction: makeTransaction(),
      wallet,
      config: { ...config, simulationTimeoutMs: 5, pollTimeoutMs: 10_000 },
    })

    expect(result.error).toBe('Transaction simulation timed out after 5ms')
  })

  it('times out wallet signing independently', async () => {
    const { server, wallet, config } = makeSetup()
    useRestoreSimulation(server)
    wallet.signTransaction = vi.fn(() => new Promise(() => {}))

    const result = await executeWithRestore({
      server,
      transaction: makeTransaction(),
      wallet,
      config: { ...config, walletSigningTimeoutMs: 5, pollTimeoutMs: 10_000 },
    })

    expect(result.error).toBe('Wallet signing timed out after 5ms')
  })

  it('times out restore confirmation independently', async () => {
    const { server, wallet, config } = makeSetup()
    useRestoreSimulation(server)
    vi.mocked(server.sendTransaction).mockResolvedValue({ hash: 'restore-hash' } as never)
    mocks.waitForTransaction.mockImplementation(() => new Promise(() => {}))

    const result = await executeWithRestore({
      server,
      transaction: makeTransaction(),
      wallet,
      config: { ...config, restoreConfirmationTimeoutMs: 5, pollTimeoutMs: 10_000 },
    })

    expect(result.error).toBe('Restore confirmation timed out after 5ms')
  })

  it('times out original submission independently', async () => {
    const { server, wallet, config } = makeSetup()
    useRestoreSimulation(server)
    vi.mocked(server.sendTransaction)
      .mockResolvedValueOnce({ hash: 'restore-hash' } as never)
      .mockImplementationOnce(() => new Promise(() => {}))

    const result = await executeWithRestore({
      server,
      transaction: makeTransaction(),
      wallet,
      config: { ...config, originalSubmissionTimeoutMs: 5, pollTimeoutMs: 10_000 },
    })

    expect(result.error).toBe('Original transaction submission timed out after 5ms')
  })
})
