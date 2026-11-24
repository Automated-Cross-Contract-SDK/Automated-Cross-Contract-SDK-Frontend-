import { describe, expect, it, vi } from 'vitest'
import {
  Account,
  Address,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'
import { SorobanResurrect } from '../SorobanResurrect.js'
import { archivedKeysInResources, extractAutoRestoredKeys } from '../Archiver.js'
import type { WalletAdapter } from '../types.js'

// Protocol 23+ RPC answers with a plain success and lists archived entries by
// index into the read-write footprint (no restorePreamble).
const NP = Networks.TESTNET
const kp = Keypair.random()
const contract = Address.contract(new Uint8Array(32).fill(3))

function dataKey(seed: number): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contract.toScAddress(),
      key: xdr.ScVal.scvU32(seed),
      durability: xdr.ContractDataDurability.persistent,
    }),
  )
}

const keys = [dataKey(0), dataKey(1), dataKey(2)]

function sorobanData(archived: number[]): SorobanDataBuilder {
  const base = new SorobanDataBuilder().setReadWrite(keys).setResourceFee('7000').build()
  return new SorobanDataBuilder(
    new xdr.SorobanTransactionData({
      resources: base.resources,
      resourceFee: base.resourceFee,
      ext:
        archived.length > 0
          ? xdr.SorobanTransactionDataExt.resourceExt(
              new xdr.SorobanResourcesExtV0({ archivedSorobanEntries: archived }),
            )
          : xdr.SorobanTransactionDataExt.v0(),
    }),
  )
}

function simulation(archived: number[]) {
  return {
    _parsed: true,
    id: '1',
    events: [],
    latestLedger: 100,
    minResourceFee: '7000',
    transactionData: sorobanData(archived),
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
  } as never
}

function callTransaction(): Transaction {
  return new TransactionBuilder(new Account(kp.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: NP,
  })
    .addOperation(new Contract(contract.toString()).call('withdraw'))
    .setTimeout(60)
    .build()
}

function makeSdk(archived: number[], maxRestoreFeeStroops?: number) {
  const sdk = new SorobanResurrect({
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: NP,
    ...(maxRestoreFeeStroops ? { maxRestoreFeeStroops } : {}),
  })
  vi.spyOn(sdk.server, 'simulateTransaction').mockResolvedValue(simulation(archived))
  return sdk
}

describe('automatic restoration (CAP-0066)', () => {
  it('reads archived entries from the simulated resources', () => {
    const found = extractAutoRestoredKeys(simulation([2, 0])).map((entry) => entry.keyBase64)
    expect(found.sort()).toEqual([keys[0], keys[2]].map((key) => key.toXdr('base64')).sort())
    expect(extractAutoRestoredKeys(simulation([]))).toEqual([])
  })

  it('is reported by detection, estimates and previews', async () => {
    const sdk = makeSdk([1])
    const tx = callTransaction()
    expect(await sdk.needsRestore(tx)).toBe(true)
    expect(await sdk.detectArchivedKeys(tx)).toHaveLength(1)
    expect(await sdk.estimateRestoreCost(tx)).toMatchObject({
      wouldNeedRestore: true,
      restoreMode: 'automatic',
      estimatedFee: '7000',
    })
    expect(await sdk.previewRestore(tx)).toMatchObject({
      wouldNeedRestore: true,
      restoreMode: 'automatic',
      archivedKeysDetected: 1,
    })
  })

  it('restores and submits with a single signature', async () => {
    const sdk = makeSdk([1])
    const send = vi
      .spyOn(sdk.server, 'sendTransaction')
      .mockResolvedValue({ status: 'PENDING', hash: 'a'.repeat(64) } as never)
    vi.spyOn(sdk.server, 'getTransaction').mockResolvedValue({ status: 'SUCCESS' } as never)
    const signTransaction = vi.fn(async (envelope: string) => {
      const tx = TransactionBuilder.fromXDR(envelope, NP)
      tx.sign(kp)
      return tx.toXDR()
    })
    const wallet = {
      isConnected: async () => true,
      getPublicKey: async () => kp.publicKey(),
      signTransaction,
    } as unknown as WalletAdapter
    const onRestoreNeeded = vi.fn()

    const result = await sdk.submitWithRestore({
      transaction: callTransaction(),
      wallet,
      onRestoreNeeded,
    })

    expect(result).toMatchObject({
      success: true,
      archivedKeysDetected: 1,
      restoreMode: 'automatic',
    })
    expect(result.restoreTxHash).toBeUndefined()
    expect(signTransaction).toHaveBeenCalledTimes(1)
    expect(onRestoreNeeded).toHaveBeenCalledTimes(1)

    const envelope = (send.mock.calls[0][0] as Transaction).toEnvelope()
    if (envelope.type !== 'envelopeTypeTx' || !('sorobanData' in envelope.v1.tx.ext)) {
      throw new Error('expected an assembled transaction')
    }
    expect(archivedKeysInResources(envelope.v1.tx.ext.sorobanData)).toHaveLength(1)
  })

  it('restores every transaction of a batch and can retry from history', async () => {
    const sdk = makeSdk([1])
    const send = vi
      .spyOn(sdk.server, 'sendTransaction')
      .mockResolvedValue({ status: 'PENDING', hash: 'b'.repeat(64) } as never)
    vi.spyOn(sdk.server, 'getTransaction').mockResolvedValue({ status: 'SUCCESS' } as never)
    const wallet = {
      isConnected: async () => true,
      getPublicKey: async () => kp.publicKey(),
      signTransaction: async (envelope: string) => envelope,
    } as unknown as WalletAdapter

    const results = await sdk.submitBatchWithRestore([
      { transaction: callTransaction(), wallet },
      { transaction: callTransaction(), wallet },
    ])
    expect(results).toHaveLength(2)
    for (const result of results) {
      expect(result).toMatchObject({ success: true, restoreMode: 'automatic' })
    }
    expect(send).toHaveBeenCalledTimes(2)

    const retried = await sdk.retry(sdk.history[0].id, wallet)
    expect(retried).toMatchObject({ success: true, restoreMode: 'automatic' })
  })

  it('honours per-request overrides and sponsors submissions with a fee bump', async () => {
    const sdk = makeSdk([1])
    const wallet = {
      isConnected: async () => true,
      getPublicKey: async () => kp.publicKey(),
      signTransaction: async (envelope: string) => {
        const tx = TransactionBuilder.fromXDR(envelope, NP)
        tx.sign(kp)
        return tx.toXDR()
      },
    } as unknown as WalletAdapter
    const capped = await sdk.submitWithRestore({
      transaction: callTransaction(),
      wallet,
      configOverrides: { maxRestoreFeeStroops: 10 },
    })
    expect(capped.errorCode).toBe('RESTORE_FEE_CAP_EXCEEDED')

    const send = vi
      .spyOn(sdk.server, 'sendTransaction')
      .mockResolvedValue({ status: 'PENDING', hash: 'c'.repeat(64) } as never)
    vi.spyOn(sdk.server, 'getTransaction').mockResolvedValue({ status: 'SUCCESS' } as never)
    const sponsor = Keypair.random()
    const sponsored = await sdk.submitWithRestore({
      transaction: callTransaction(),
      wallet,
      feeBumpConfig: {
        sponsor: {
          getPublicKey: async () => sponsor.publicKey(),
          signFeeBump: async (envelope: string) => {
            const tx = TransactionBuilder.fromXDR(envelope, NP)
            tx.sign(sponsor)
            return tx.toXDR()
          },
        } as never,
      },
    })
    expect(sponsored).toMatchObject({ success: true })
    const bump = send.mock.calls[0][0] as FeeBumpTransaction
    expect(bump).toBeInstanceOf(FeeBumpTransaction)
    // 100-stroop inclusion fee for two operations, plus the resource fee once.
    expect(bump.fee).toBe('7200')
  })

  it('applies maxRestoreFeeStroops before prompting the wallet', async () => {
    const sdk = makeSdk([1], 5000)
    const signTransaction = vi.fn()
    const wallet = { isConnected: async () => true, signTransaction } as unknown as WalletAdapter
    const result = await sdk.submitWithRestore({ transaction: callTransaction(), wallet })
    expect(result).toMatchObject({ success: false, errorCode: 'RESTORE_FEE_CAP_EXCEEDED' })
    expect(signTransaction).not.toHaveBeenCalled()
  })

  it('rejects a wallet that returns a different transaction', async () => {
    const sdk = makeSdk([])
    const send = vi.spyOn(sdk.server, 'sendTransaction')
    const other = new TransactionBuilder(new Account(kp.publicKey(), '9'), {
      fee: '100',
      networkPassphrase: NP,
    })
      .addOperation(new Contract(contract.toString()).call('drain'))
      .setTimeout(60)
      .build()
    const wallet = {
      isConnected: async () => true,
      getPublicKey: async () => kp.publicKey(),
      signTransaction: async () => other.toXDR(),
    } as unknown as WalletAdapter

    const result = await sdk.submitWithRestore({ transaction: callTransaction(), wallet })
    expect(result).toMatchObject({ success: false, errorCode: 'SIGNED_TRANSACTION_MISMATCH' })
    expect(send).not.toHaveBeenCalled()
  })
})
