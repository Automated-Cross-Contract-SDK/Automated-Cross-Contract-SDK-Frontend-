import { describe, expect, it, vi } from 'vitest'
import { Account, Keypair, rpc, xdr, type Transaction } from '@stellar/stellar-sdk'
import {
  ResilientRpcClient,
  type ISorobanRpcClient,
  type RpcResilienceOptions,
} from '../RpcClient.js'

const testOptions: RpcResilienceOptions = {
  timeoutMs: 100,
  retryCount: 1,
  retryBackoffMs: 0,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 100,
}

function makeClient(): ISorobanRpcClient {
  return {
    simulateTransaction: vi.fn().mockResolvedValue({ id: 'simulation' } as never),
    sendTransaction: vi.fn().mockResolvedValue({ hash: 'transaction-hash' } as never),
    getTransaction: vi
      .fn()
      .mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS } as never),
    getAccount: vi.fn().mockResolvedValue(new Account(Keypair.random().publicKey(), '1')),
    getLedgerEntries: vi.fn().mockResolvedValue({ entries: [], latestLedger: 1 } as never),
    getLatestLedger: vi.fn().mockResolvedValue({ id: 'ledger', sequence: 1 } as never),
  }
}

interface RpcStage {
  name: string
  invoke: (client: ISorobanRpcClient) => Promise<unknown>
  rejectFirstAttempt: (client: ISorobanRpcClient, error: Error) => void
  delayFirstAttempt: (client: ISorobanRpcClient, delayMs: number) => void
  mock: (client: ISorobanRpcClient) => { mock: { calls: unknown[][] } }
}

const rpcStages: RpcStage[] = [
  {
    name: 'simulation',
    invoke: (client) => client.simulateTransaction({} as Transaction),
    rejectFirstAttempt: (client, error) =>
      vi.mocked(client.simulateTransaction).mockRejectedValueOnce(error),
    delayFirstAttempt: (client, delayMs) =>
      vi
        .mocked(client.simulateTransaction)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => setTimeout(() => resolve({ id: 'late' } as never), delayMs)),
        ),
    mock: (client) => client.simulateTransaction,
  },
  {
    name: 'restore transaction submission',
    invoke: (client) => client.sendTransaction({} as Transaction),
    rejectFirstAttempt: (client, error) =>
      vi.mocked(client.sendTransaction).mockRejectedValueOnce(error),
    delayFirstAttempt: (client, delayMs) =>
      vi
        .mocked(client.sendTransaction)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => setTimeout(() => resolve({ hash: 'late' } as never), delayMs)),
        ),
    mock: (client) => client.sendTransaction,
  },
  {
    name: 'confirmation polling',
    invoke: (client) => client.getTransaction('transaction-hash'),
    rejectFirstAttempt: (client, error) =>
      vi.mocked(client.getTransaction).mockRejectedValueOnce(error),
    delayFirstAttempt: (client, delayMs) =>
      vi
        .mocked(client.getTransaction)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () => resolve({ status: rpc.Api.GetTransactionStatus.SUCCESS } as never),
                delayMs,
              ),
            ),
        ),
    mock: (client) => client.getTransaction,
  },
  {
    name: 'account lookup',
    invoke: (client) => client.getAccount(Keypair.random().publicKey()),
    rejectFirstAttempt: (client, error) =>
      vi.mocked(client.getAccount).mockRejectedValueOnce(error),
    delayFirstAttempt: (client, delayMs) =>
      vi
        .mocked(client.getAccount)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve(new Account(Keypair.random().publicKey(), '1')), delayMs),
            ),
        ),
    mock: (client) => client.getAccount,
  },
  {
    name: 'ledger entry lookup',
    invoke: (client) => client.getLedgerEntries({} as xdr.LedgerKey),
    rejectFirstAttempt: (client, error) =>
      vi.mocked(client.getLedgerEntries).mockRejectedValueOnce(error),
    delayFirstAttempt: (client, delayMs) =>
      vi
        .mocked(client.getLedgerEntries)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ entries: [], latestLedger: 1 } as never), delayMs),
            ),
        ),
    mock: (client) => client.getLedgerEntries,
  },
  {
    name: 'latest ledger lookup',
    invoke: (client) => client.getLatestLedger(),
    rejectFirstAttempt: (client, error) =>
      vi.mocked(client.getLatestLedger).mockRejectedValueOnce(error),
    delayFirstAttempt: (client, delayMs) =>
      vi
        .mocked(client.getLatestLedger)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ id: 'late', sequence: 1 } as never), delayMs),
            ),
        ),
    mock: (client) => client.getLatestLedger,
  },
]

describe('ResilientRpcClient fault injection', () => {
  it.each(rpcStages)('recovers from a transient disconnect during $name', async (stage) => {
    const client = makeClient()
    stage.rejectFirstAttempt(client, new Error('connection reset'))

    const resilient = new ResilientRpcClient(client, testOptions)
    await expect(stage.invoke(resilient)).resolves.toBeDefined()
    expect(stage.mock(client).mock.calls).toHaveLength(2)
  })

  it.each(rpcStages)('recovers from an RPC server error during $name', async (stage) => {
    const client = makeClient()
    stage.rejectFirstAttempt(client, Object.assign(new Error('server error'), { status: 500 }))

    const resilient = new ResilientRpcClient(client, testOptions)
    await expect(stage.invoke(resilient)).resolves.toBeDefined()
    expect(stage.mock(client).mock.calls).toHaveLength(2)
  })

  it.each(rpcStages)('recovers from a timeout during $name', async (stage) => {
    const client = makeClient()
    stage.delayFirstAttempt(client, 25)

    const resilient = new ResilientRpcClient(client, { ...testOptions, timeoutMs: 5 })
    await expect(stage.invoke(resilient)).resolves.toBeDefined()
    expect(stage.mock(client).mock.calls).toHaveLength(2)
  })

  it('does not retry beyond the configured attempt count', async () => {
    const client = makeClient()
    vi.mocked(client.getLatestLedger).mockRejectedValue(new Error('offline'))

    const resilient = new ResilientRpcClient(client, { ...testOptions, retryCount: 2 })
    await expect(resilient.getLatestLedger()).rejects.toThrow('offline')
    expect(client.getLatestLedger).toHaveBeenCalledTimes(3)
  })
})
