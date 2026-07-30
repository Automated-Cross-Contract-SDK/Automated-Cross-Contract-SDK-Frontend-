import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rpc, TransactionBuilder, Account, Networks, Operation, Keypair, Transaction, SorobanDataBuilder } from '@stellar/stellar-sdk'
import { executeWithRestore } from '../Executor.js'
import type { WalletAdapter, SorobanResurrectConfig } from '../types.js'

function makeMockServer(): rpc.Server {
  const mockSorobanData = new SorobanDataBuilder().build()
  const mockLedgerKey = { toXDR: () => 'base64-key' }
  return {
    simulateTransaction: vi.fn().mockResolvedValue({
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
    }),
    getAccount: vi.fn().mockImplementation(async (pubKey: string) => new Account(pubKey, '1')),
    sendTransaction: vi.fn().mockResolvedValue({ hash: 'tx-hash-1' }),
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

const defaultConfig: SorobanResurrectConfig = {
  rpcUrl: 'https://testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  pollIntervalMs: 10,
  pollTimeoutMs: 5000,
}

describe('wallet edge cases', () => {
  let server: rpc.Server

  beforeEach(() => {
    server = makeMockServer()
  })

  it('handles the wallet rejecting the signing request', async () => {
    const wallet: WalletAdapter = {
      isConnected: vi.fn().mockResolvedValue(true),
      getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
      signTransaction: vi.fn().mockRejectedValue(new Error('User rejected the request')),
    }

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('rejected')
  })

  it('handles a malformed/unparseable signature returned by the wallet', async () => {
    const wallet: WalletAdapter = {
      isConnected: vi.fn().mockResolvedValue(true),
      getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
      signTransaction: vi.fn().mockResolvedValue('not-a-valid-xdr-string'),
    }

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('handles the wallet connection dropping mid-workflow (after the restore step, before signing the original tx)', async () => {
    let signCallCount = 0
    const wallet: WalletAdapter = {
      isConnected: vi.fn().mockResolvedValue(true),
      getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
      signTransaction: vi.fn().mockImplementation(async (tx: string) => {
        signCallCount += 1
        if (signCallCount === 1) return tx // signs restore tx fine
        throw new Error('Wallet disconnected') // drops before signing original tx
      }),
    }

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('disconnected')
  })

  it('proceeds using whatever public key the wallet returns, even if it differs from the original tx source account', async () => {
    const differentKey = Keypair.random().publicKey()
    const wallet: WalletAdapter = {
      isConnected: vi.fn().mockResolvedValue(true),
      getPublicKey: vi.fn().mockResolvedValue(differentKey),
      signTransaction: vi.fn().mockImplementation(async (tx: string) => tx),
    }

    await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
    })

    // Documents current behavior: the restore flow fetches the account for
    // the wallet-reported key, not the original transaction's source account.
    expect(server.getAccount).toHaveBeenCalledWith(differentKey)
  })
})
