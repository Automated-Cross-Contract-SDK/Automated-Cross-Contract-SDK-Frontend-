import { describe, expect, it, vi } from 'vitest'
import { Account, Address, Keypair, Networks, SorobanDataBuilder, xdr } from '@stellar/stellar-sdk'
import type { Transaction } from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from '../RpcClient.js'
import type { SorobanResurrectConfig, WalletAdapter } from '../types.js'
import { extendLedgerTTL } from '../TTLWatch.js'

function persistentKey(): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.contract(Buffer.alloc(32, 7)).toScAddress(),
      key: xdr.ScVal.scvU32(1),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  )
}

function temporaryKey(): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.contract(Buffer.alloc(32, 7)).toScAddress(),
      key: xdr.ScVal.scvU32(1),
      durability: xdr.ContractDataDurability.temporary(),
    }),
  )
}

function accountKey(): xdr.LedgerKey {
  return xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.random().xdrPublicKey() }),
  )
}

function makeConfig(server: ISorobanRpcClient): Required<SorobanResurrectConfig> {
  return {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    rpcClient: server,
    pollIntervalMs: 1,
    pollTimeoutMs: 1_000,
    simulationTimeoutMs: 1_000,
    walletSigningTimeoutMs: 1_000,
    restoreConfirmationTimeoutMs: 1_000,
    originalSubmissionTimeoutMs: 1_000,
    restoreFeeMultiplier: 3,
  } as Required<SorobanResurrectConfig>
}

function makeWallet(publicKey: string): WalletAdapter {
  return {
    isConnected: vi.fn().mockResolvedValue(true),
    getPublicKey: vi.fn().mockResolvedValue(publicKey),
    signTransaction: vi.fn(async (transactionXdr: string) => transactionXdr),
    getNetwork: vi.fn().mockResolvedValue(Networks.TESTNET),
  }
}

function makeServer(publicKey: string) {
  const sendTransaction = vi.fn(async (_transaction: Transaction) => ({
    hash: 'ttl-extension-hash',
  }))
  const server = {
    getAccount: vi.fn(async () => new Account(publicKey, '1')),
    simulateTransaction: vi.fn(async () => ({
      _parsed: true,
      minResourceFee: '100',
      transactionData: {
        build: () => new SorobanDataBuilder().setReadOnly([persistentKey()]).build(),
      },
    })),
    sendTransaction,
    getTransaction: vi.fn(async () => ({
      status: 'SUCCESS',
    })),
  } as unknown as ISorobanRpcClient
  return { server, sendTransaction }
}

describe('extendLedgerTTL', () => {
  it('estimates the fee and submits an extend-footprint-TTL transaction after confirmation', async () => {
    const publicKey = Keypair.random().publicKey()
    const { server, sendTransaction } = makeServer(publicKey)
    const wallet = makeWallet(publicKey)
    const confirmFee = vi.fn().mockResolvedValue(true)

    const result = await extendLedgerTTL(server, makeConfig(server), [persistentKey()], {
      wallet,
      extendTo: 100_000,
      confirmFee,
    })

    expect(result).toMatchObject({
      status: 'submitted',
      transactionHash: 'ttl-extension-hash',
      estimate: {
        minResourceFee: 100,
        multiplier: 3,
        estimatedFee: '300',
        keyCount: 1,
        extendTo: 100_000,
      },
    })
    expect(confirmFee.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(wallet.signTransaction).mock.invocationCallOrder[0],
    )
    expect(wallet.signTransaction).toHaveBeenCalledOnce()
    expect(sendTransaction).toHaveBeenCalledOnce()
    expect(sendTransaction.mock.calls[0][0].operations[0].type).toBe('extendFootprintTtl')
  })

  it('does not prompt the wallet or submit when the fee is declined', async () => {
    const publicKey = Keypair.random().publicKey()
    const { server, sendTransaction } = makeServer(publicKey)
    const wallet = makeWallet(publicKey)
    const result = await extendLedgerTTL(server, makeConfig(server), [persistentKey()], {
      wallet,
      extendTo: 100_000,
      confirmFee: vi.fn().mockResolvedValue(false),
    })

    expect(result.status).toBe('declined')
    expect(wallet.signTransaction).not.toHaveBeenCalled()
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('rejects temporary and non-contract entries', async () => {
    const publicKey = Keypair.random().publicKey()
    const { server } = makeServer(publicKey)
    const wallet = makeWallet(publicKey)
    const options = { wallet, extendTo: 100_000, confirmFee: vi.fn().mockResolvedValue(true) }

    await expect(
      extendLedgerTTL(server, makeConfig(server), [temporaryKey()], options),
    ).rejects.toThrow('only persistent contract data and contract code keys are supported')
    await expect(
      extendLedgerTTL(server, makeConfig(server), [accountKey()], options),
    ).rejects.toThrow('only persistent contract data and contract code keys are supported')
    await expect(extendLedgerTTL(server, makeConfig(server), [], options)).rejects.toThrow(
      'at least one ledger key is required',
    )
    await expect(
      extendLedgerTTL(server, makeConfig(server), [persistentKey()], {
        ...options,
        extendTo: 1.5,
      }),
    ).rejects.toThrow('`extendTo` must be a positive integer')
  })

  it('bounds fee simulation independently', async () => {
    const publicKey = Keypair.random().publicKey()
    const { server } = makeServer(publicKey)
    vi.mocked(server.simulateTransaction).mockImplementation(() => new Promise(() => {}))

    await expect(
      extendLedgerTTL(
        server,
        { ...makeConfig(server), simulationTimeoutMs: 5 },
        [persistentKey()],
        {
          wallet: makeWallet(publicKey),
          extendTo: 100_000,
          confirmFee: vi.fn().mockResolvedValue(true),
        },
      ),
    ).rejects.toThrow('TTL extension fee simulation timed out after 5ms')
  })

  it('bounds wallet signing independently', async () => {
    const publicKey = Keypair.random().publicKey()
    const { server, sendTransaction } = makeServer(publicKey)
    const wallet = makeWallet(publicKey)
    wallet.signTransaction = vi.fn(() => new Promise(() => {}))

    await expect(
      extendLedgerTTL(
        server,
        { ...makeConfig(server), walletSigningTimeoutMs: 5 },
        [persistentKey()],
        {
          wallet,
          extendTo: 100_000,
          confirmFee: vi.fn().mockResolvedValue(true),
        },
      ),
    ).rejects.toThrow('Wallet signing timed out after 5ms')
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('bounds original submission independently', async () => {
    const publicKey = Keypair.random().publicKey()
    const { server, sendTransaction } = makeServer(publicKey)
    sendTransaction.mockImplementation(() => new Promise(() => {}))

    await expect(
      extendLedgerTTL(
        server,
        { ...makeConfig(server), originalSubmissionTimeoutMs: 5 },
        [persistentKey()],
        {
          wallet: makeWallet(publicKey),
          extendTo: 100_000,
          confirmFee: vi.fn().mockResolvedValue(true),
        },
      ),
    ).rejects.toThrow('TTL extension submission timed out after 5ms')
  })

  it('bounds transaction confirmation independently', async () => {
    const publicKey = Keypair.random().publicKey()
    const { server } = makeServer(publicKey)
    vi.mocked(server.getTransaction).mockImplementation(() => new Promise(() => {}))

    await expect(
      extendLedgerTTL(
        server,
        { ...makeConfig(server), restoreConfirmationTimeoutMs: 5 },
        [persistentKey()],
        {
          wallet: makeWallet(publicKey),
          extendTo: 100_000,
          confirmFee: vi.fn().mockResolvedValue(true),
        },
      ),
    ).rejects.toThrow('TTL extension confirmation timed out after 5ms')
  })
})
