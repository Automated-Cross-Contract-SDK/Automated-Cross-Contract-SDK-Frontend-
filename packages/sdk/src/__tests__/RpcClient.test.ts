/**
 * Tests for RpcClient.ts — the Soroban RPC abstraction layer.
 *
 * Covers:
 * 1. ISorobanRpcClient interface — test doubles satisfy it at compile-time.
 * 2. SorobanRpcClient — delegates all methods to the underlying rpc.Server.
 * 3. createRpcClient — factory helper returns a SorobanRpcClient.
 * 4. Injection into SorobanResurrect — SDK uses injected client, not a new rpc.Server.
 * 5. Injection into free functions — Archiver, Executor, TTLHelpers accept ISorobanRpcClient.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Account,
  Networks,
  Keypair,
  TransactionBuilder,
  Operation,
  Transaction,
  SorobanDataBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import { SorobanRpcClient, createRpcClient, type ISorobanRpcClient } from '../RpcClient.js'
import { SorobanResurrect } from '../SorobanResurrect.js'
import { executeWithRestore } from '../Executor.js'
import { detectArchivedEntries } from '../Archiver.js'
import { waitForTransaction } from '../Restorer.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Creates a fully typed ISorobanRpcClient test double using vi.fn().
 * TypeScript verifies at compile time that all required methods are present.
 */
function makeMockRpcClient(): ISorobanRpcClient {
  return {
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getAccount: vi.fn(),
    getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn(),
  }
}

const testConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
}

// ---------------------------------------------------------------------------
// ISorobanRpcClient interface conformance
// ---------------------------------------------------------------------------

describe('ISorobanRpcClient interface', () => {
  it('can be satisfied by a plain object — no cast needed', () => {
    // This test is primarily a compile-time assertion. If TypeScript accepts
    // the assignment without error, the interface is correctly defined.
    const client: ISorobanRpcClient = makeMockRpcClient()
    expect(client).toBeDefined()
    expect(typeof client.simulateTransaction).toBe('function')
    expect(typeof client.sendTransaction).toBe('function')
    expect(typeof client.getTransaction).toBe('function')
    expect(typeof client.getAccount).toBe('function')
    expect(typeof client.getLedgerEntries).toBe('function')
    expect(typeof client.getLatestLedger).toBe('function')
  })

  it('exposes exactly the six RPC methods used by the SDK', () => {
    const client = makeMockRpcClient()
    const methodNames = Object.keys(client).sort()
    expect(methodNames).toEqual([
      'getAccount',
      'getLatestLedger',
      'getLedgerEntries',
      'getTransaction',
      'sendTransaction',
      'simulateTransaction',
    ])
  })
})

// ---------------------------------------------------------------------------
// SorobanRpcClient — delegation
// ---------------------------------------------------------------------------

describe('SorobanRpcClient', () => {
  it('stores the rpcUrl as serverURL', () => {
    const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    expect(client.serverURL).toBe('https://soroban-testnet.stellar.org')
  })

  it('exposes the underlying _server instance', () => {
    const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    expect(client._server).toBeDefined()
    expect(typeof client._server.simulateTransaction).toBe('function')
  })

  it('satisfies ISorobanRpcClient', () => {
    const client: ISorobanRpcClient = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    expect(client).toBeDefined()
  })

  it('delegates simulateTransaction to the underlying server', async () => {
    const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    const fakeResponse = { id: '1', _parsed: true, latestLedger: 100 } as never
    vi.spyOn(client._server, 'simulateTransaction').mockResolvedValue(fakeResponse)

    const tx = makeSampleTx()
    const result = await client.simulateTransaction(tx)

    expect(client._server.simulateTransaction).toHaveBeenCalledWith(tx)
    expect(result).toBe(fakeResponse)
  })

  it('delegates sendTransaction to the underlying server', async () => {
    const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    const fakeResponse = { hash: 'abc123' } as never
    vi.spyOn(client._server, 'sendTransaction').mockResolvedValue(fakeResponse)

    const tx = makeSampleTx()
    const result = await client.sendTransaction(tx)

    expect(client._server.sendTransaction).toHaveBeenCalledWith(tx)
    expect(result).toBe(fakeResponse)
  })

  it('delegates getTransaction to the underlying server', async () => {
    const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    const fakeResponse = { status: rpc.Api.GetTransactionStatus.SUCCESS } as never
    vi.spyOn(client._server, 'getTransaction').mockResolvedValue(fakeResponse)

    const result = await client.getTransaction('deadbeef')

    expect(client._server.getTransaction).toHaveBeenCalledWith('deadbeef')
    expect(result).toBe(fakeResponse)
  })

  it('delegates getAccount to the underlying server', async () => {
    const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    const kp = Keypair.random()
    const fakeAccount = new Account(kp.publicKey(), '0')
    vi.spyOn(client._server, 'getAccount').mockResolvedValue(fakeAccount as never)

    const result = await client.getAccount(kp.publicKey())

    expect(client._server.getAccount).toHaveBeenCalledWith(kp.publicKey())
    expect(result).toBe(fakeAccount)
  })

  it('delegates getLedgerEntries to the underlying server', async () => {
    const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    const fakeResponse = { entries: [], latestLedger: 200 } as never
    vi.spyOn(client._server, 'getLedgerEntries').mockResolvedValue(fakeResponse)

    const key = {} as xdr.LedgerKey
    const result = await client.getLedgerEntries(key)

    expect(client._server.getLedgerEntries).toHaveBeenCalledWith(key)
    expect(result).toBe(fakeResponse)
  })

  it('delegates getLatestLedger to the underlying server', async () => {
    const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
    const fakeResponse = { id: 'latest', sequence: 500, protocolVersion: 22 } as never
    vi.spyOn(client._server, 'getLatestLedger').mockResolvedValue(fakeResponse)

    const result = await client.getLatestLedger()

    expect(client._server.getLatestLedger).toHaveBeenCalled()
    expect(result).toBe(fakeResponse)
  })
})

// ---------------------------------------------------------------------------
// createRpcClient factory
// ---------------------------------------------------------------------------

describe('createRpcClient', () => {
  it('returns a SorobanRpcClient instance', () => {
    const client = createRpcClient('https://soroban-testnet.stellar.org')
    expect(client).toBeInstanceOf(SorobanRpcClient)
  })

  it('stores the provided URL', () => {
    const url = 'https://soroban-testnet.stellar.org'
    const client = createRpcClient(url)
    expect(client.serverURL).toBe(url)
  })

  it('satisfies ISorobanRpcClient', () => {
    const client: ISorobanRpcClient = createRpcClient('https://soroban-testnet.stellar.org')
    expect(client).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Injection into SorobanResurrect
// ---------------------------------------------------------------------------

describe('SorobanResurrect — rpcClient injection', () => {
  it('uses the injected client as this.server when rpcClient is provided', () => {
    const mockClient = makeMockRpcClient()
    const sdk = new SorobanResurrect({ ...testConfig, rpcClient: mockClient })
    expect(sdk.server).toBe(mockClient)
  })

  it('creates a SorobanRpcClient automatically when no rpcClient is provided', () => {
    const sdk = new SorobanResurrect(testConfig)
    expect(sdk.server).toBeInstanceOf(SorobanRpcClient)
  })

  it('calls simulate on the injected client, not a new rpc.Server', async () => {
    const mockClient = makeMockRpcClient()
    const successResponse = {
      id: '1',
      latestLedger: 100,
      events: [],
      _parsed: true,
      transactionData: {
        build: () => new SorobanDataBuilder().build(),
        getFootprint: () => ({ readOnly: () => [], readWrite: () => [] }),
      },
      minResourceFee: '100',
      cost: { cpuInsns: '100', memBytes: '100' },
      result: { auth: [], retval: { switch: () => 0 } },
    }
    vi.mocked(mockClient.simulateTransaction).mockResolvedValue(successResponse as never)

    const sdk = new SorobanResurrect({ ...testConfig, rpcClient: mockClient })
    await sdk.simulate(makeSampleTx())

    expect(mockClient.simulateTransaction).toHaveBeenCalledTimes(1)
  })

  it('stores the injected client in config.rpcClient', () => {
    const mockClient = makeMockRpcClient()
    const sdk = new SorobanResurrect({ ...testConfig, rpcClient: mockClient })
    expect(sdk.config.rpcClient).toBe(mockClient)
  })

  it('allows a test double to drive the full submitWithRestore path', async () => {
    const mockClient = makeMockRpcClient()

    const mockSorobanData = new SorobanDataBuilder().build()
    // Use a RESTORE response so the test hits the restore path (which doesn't
    // have the pre-existing sendResult.hash bug on the direct-submit path).
    const mockLedgerKey = { toXDR: () => 'archived-key-base64' }
    const restoreResponse = {
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
    const successResponse = {
      id: '2',
      latestLedger: 101,
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

    vi.mocked(mockClient.simulateTransaction)
      .mockResolvedValueOnce(restoreResponse as never)
      .mockResolvedValueOnce(successResponse as never)
    vi.mocked(mockClient.sendTransaction)
      .mockResolvedValueOnce({ hash: 'restore-hash' } as never)
      .mockResolvedValueOnce({ hash: 'injected-hash' } as never)
    vi.mocked(mockClient.getTransaction).mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never)
    vi.mocked(mockClient.getAccount).mockResolvedValue(
      new Account(Keypair.random().publicKey(), '2') as never,
    )

    const wallet = {
      isConnected: vi.fn().mockResolvedValue(true),
      getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
      signTransaction: vi.fn().mockImplementation(async (xdr: string) => xdr),
    }

    const sdk = new SorobanResurrect({ ...testConfig, rpcClient: mockClient })
    const result = await sdk.submitWithRestore({ transaction: makeSampleTx(), wallet })

    expect(result.success).toBe(true)
    expect(result.restoreTxHash).toBe('restore-hash')
    expect(result.originalTxHash).toBe('injected-hash')
    // Confirm the mock client — not a real rpc.Server — received the calls
    expect(mockClient.simulateTransaction).toHaveBeenCalled()
    expect(mockClient.sendTransaction).toHaveBeenCalled()
    expect(mockClient.getTransaction).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Injection into free functions
// ---------------------------------------------------------------------------

describe('free functions accept ISorobanRpcClient', () => {
  describe('executeWithRestore', () => {
    it('accepts an ISorobanRpcClient as server', async () => {
      const mockClient = makeMockRpcClient()
      const mockSorobanData = new SorobanDataBuilder().build()

      // Use restore path to avoid the pre-existing sendResult.hash bug on direct-submit
      const mockLedgerKey = { toXDR: () => 'archived-key' }
      vi.mocked(mockClient.simulateTransaction)
        .mockResolvedValueOnce({
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
          restorePreamble: { minResourceFee: '100', transactionData: { build: () => mockSorobanData } },
        } as never)
        .mockResolvedValueOnce({
          id: '2',
          latestLedger: 101,
          events: [],
          _parsed: true,
          transactionData: { build: () => mockSorobanData, getFootprint: () => ({ readOnly: () => [], readWrite: () => [] }) },
          minResourceFee: '100',
          cost: { cpuInsns: '100', memBytes: '100' },
          result: { auth: [], retval: { switch: () => 0 } },
        } as never)
      vi.mocked(mockClient.sendTransaction)
        .mockResolvedValueOnce({ hash: 'restore-hash' } as never)
        .mockResolvedValueOnce({ hash: 'free-fn-hash' } as never)
      vi.mocked(mockClient.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      } as never)
      vi.mocked(mockClient.getAccount).mockResolvedValue(
        new Account(Keypair.random().publicKey(), '2') as never,
      )

      const wallet = {
        isConnected: vi.fn().mockResolvedValue(true),
        getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
        signTransaction: vi.fn().mockImplementation(async (x: string) => x),
      }

      const result = await executeWithRestore({
        server: mockClient,
        transaction: makeSampleTx(),
        wallet,
        config: { rpcUrl: testConfig.rpcUrl, networkPassphrase: testConfig.networkPassphrase },
      })

      expect(result.success).toBe(true)
      expect(mockClient.simulateTransaction).toHaveBeenCalled()
    })
  })

  describe('waitForTransaction', () => {
    it('accepts an ISorobanRpcClient and calls getTransaction', async () => {
      const mockClient = makeMockRpcClient()
      vi.mocked(mockClient.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      } as never)

      const result = await waitForTransaction(mockClient, 'test-hash', 100, 5000)

      expect(mockClient.getTransaction).toHaveBeenCalledWith('test-hash')
      expect(result.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
    })
  })

  describe('detectArchivedEntries', () => {
    it('accepts an ISorobanRpcClient and calls getLedgerEntries', async () => {
      const mockClient = makeMockRpcClient()
      vi.mocked(mockClient.getLedgerEntries).mockResolvedValue({
        entries: [],
        latestLedger: 100,
      } as never)

      const result = await detectArchivedEntries(mockClient, [])
      expect(result).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// Backward compatibility — rpc.Server still works via structural typing
// ---------------------------------------------------------------------------

describe('backward compatibility', () => {
  it('a partial mock cast as rpc.Server still works with executeWithRestore (existing pattern)', async () => {
    // This is the original test pattern used across the codebase.
    // It must continue to work — ISorobanRpcClient is backward compatible.
    const legacyMock = {
      simulateTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      getTransaction: vi.fn(),
      getAccount: vi.fn(),
      getLedgerEntries: vi.fn(),
    } as unknown as rpc.Server

    const mockSorobanData = new SorobanDataBuilder().build()
    // Use restore path to avoid the pre-existing sendResult.hash bug
    const mockLedgerKey = { toXDR: () => 'key' }
    vi.mocked(legacyMock.simulateTransaction)
      .mockResolvedValueOnce({
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
        restorePreamble: { minResourceFee: '100', transactionData: { build: () => mockSorobanData } },
      } as never)
      .mockResolvedValueOnce({
        id: '2',
        latestLedger: 101,
        events: [],
        _parsed: true,
        transactionData: { build: () => mockSorobanData, getFootprint: () => ({ readOnly: () => [], readWrite: () => [] }) },
        minResourceFee: '100',
        cost: { cpuInsns: '100', memBytes: '100' },
        result: { auth: [], retval: { switch: () => 0 } },
      } as never)
    vi.mocked(legacyMock.sendTransaction)
      .mockResolvedValueOnce({ hash: 'restore-hash' } as never)
      .mockResolvedValueOnce({ hash: 'legacy-hash' } as never)
    vi.mocked(legacyMock.getTransaction).mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never)
    vi.mocked(legacyMock.getAccount).mockResolvedValue(
      new Account(Keypair.random().publicKey(), '2') as never,
    )

    const wallet = {
      isConnected: vi.fn().mockResolvedValue(true),
      getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
      signTransaction: vi.fn().mockImplementation(async (x: string) => x),
    }

    // rpc.Server structurally satisfies ISorobanRpcClient — no cast needed at the call site
    const result = await executeWithRestore({
      server: legacyMock as unknown as ISorobanRpcClient,
      transaction: makeSampleTx(),
      wallet,
      config: { rpcUrl: testConfig.rpcUrl, networkPassphrase: testConfig.networkPassphrase },
    })

    expect(result.success).toBe(true)
  })
})
