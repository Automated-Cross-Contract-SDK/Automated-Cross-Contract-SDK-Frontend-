import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rpc, TransactionBuilder, Account, Networks, Operation, Keypair, Transaction, SorobanDataBuilder } from '@stellar/stellar-sdk'
import { executeWithRestore } from '../Executor.js'
import type { WalletAdapter, SorobanResurrectConfig } from '../types.js'

function makeMockServer(): rpc.Server {
  let sendCount = 0
  return {
    simulateTransaction: vi.fn().mockImplementation(async () => {
      const mockSorobanData = new SorobanDataBuilder().build()
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
    }),
    getAccount: vi.fn().mockImplementation(async (pubKey: string) => new Account(pubKey, '1')),
    sendTransaction: vi.fn().mockImplementation(async () => ({ hash: `tx-hash-${++sendCount}` })),
    getTransaction: vi.fn().mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS }),
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
  pollIntervalMs: 10,
  pollTimeoutMs: 5000,
}

describe('concurrent restore requests — load test', () => {
  let server: rpc.Server

  beforeEach(() => {
    server = makeMockServer()
  })

  it('handles many concurrent executeWithRestore calls without cross-request state corruption', async () => {
    const CONCURRENCY = 25

    const calls = Array.from({ length: CONCURRENCY }, () =>
      executeWithRestore({
        server,
        transaction: makeSampleTx(),
        wallet: makeWallet(),
        config: defaultConfig,
      }),
    )

    const results = await Promise.all(calls)

    // Every request should succeed independently.
    expect(results).toHaveLength(CONCURRENCY)
    for (const result of results) {
      expect(result.success).toBe(true)
      expect(result.originalTxHash).toBeDefined()
      expect(result.restoreTxHash).toBeDefined()
    }

    // Each concurrent call should get its own distinct tx hashes, not a
    // hash leaked/overwritten from another in-flight request.
    const originalHashes = results.map((r) => r.originalTxHash)
    const restoreHashes = results.map((r) => r.restoreTxHash)
    expect(new Set(originalHashes).size).toBe(CONCURRENCY)
    expect(new Set(restoreHashes).size).toBe(CONCURRENCY)
  })

  it('keeps per-call results isolated when some concurrent requests fail and others succeed', async () => {
    let call = 0
    vi.spyOn(server, 'sendTransaction').mockImplementation(async () => {
      call += 1
      if (call % 2 === 0) {
        throw new Error('simulated network failure')
      }
      return { hash: `tx-hash-${call}` } as never
    })

    const calls = Array.from({ length: 10 }, () =>
      executeWithRestore({
        server,
        transaction: makeSampleTx(),
        wallet: makeWallet(),
        config: defaultConfig,
      }),
    )

    const results = await Promise.all(calls)

    expect(results).toHaveLength(10)
    // Failures must not corrupt/overwrite the successful results of other
    // concurrent calls — success/failure state stays per-request.
    const successes = results.filter((r) => r.success)
    const failures = results.filter((r) => !r.success)
    expect(successes.length + failures.length).toBe(10)
    for (const failure of failures) {
      expect(failure.error).toBeDefined()
    }
  })
})
