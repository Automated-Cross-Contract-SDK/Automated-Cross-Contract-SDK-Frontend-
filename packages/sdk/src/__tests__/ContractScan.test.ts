/**
 * Tests for account / contract-level archived-entry scanning (#239).
 *
 * Covers:
 * 1. getExpiringEntriesForContract returns expiring + archived entries for
 *    a contract id, driven entirely by a mocked ledger response.
 * 2. Pagination / chunking — a >50-key scan fans out into multiple
 *    getLedgerEntries calls.
 * 3. includeCode reads the instance entry and adds the Wasm code key.
 * 4. getExpiringEntriesForAccount reports trustline / account presence.
 * 5. Input validation.
 */

import { describe, it, expect, vi } from 'vitest'
import { Asset, Keypair, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from '../RpcClient.js'
import {
  getExpiringEntriesForContract,
  getExpiringEntriesForAccount,
  DEFAULT_EXPIRING_SOON_LEDGERS,
} from '../ContractScan.js'

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7))
const CURRENT_LEDGER = 1_000_000

function baseMock(): ISorobanRpcClient {
  return {
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getAccount: vi.fn(),
    getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn().mockResolvedValue({ sequence: CURRENT_LEDGER } as never),
  }
}

/**
 * Wires getLedgerEntries to echo back the queried keys as live entries with
 * the given `liveUntilLedgerSeq`, unless a key's base64 is in `archived`
 * (then it is omitted from the response = archived).
 */
function respondWithTTL(
  mock: ISorobanRpcClient,
  liveUntilLedgerSeq: number,
  archived: Set<string> = new Set(),
) {
  vi.mocked(mock.getLedgerEntries).mockImplementation((...keys: xdr.LedgerKey[]) => {
    const entries = keys
      .filter((k) => !archived.has(k.toXDR('base64')))
      .map((k) => ({ key: k, liveUntilLedgerSeq }))
    return Promise.resolve({ entries, latestLedger: CURRENT_LEDGER } as never)
  })
}

describe('getExpiringEntriesForContract', () => {
  it('classifies scanned entries as expiring-soon or archived', async () => {
    const mock = baseMock()
    const storageKeys = [nativeToScVal('counter'), nativeToScVal('config')]
    // instance + 2 storage keys = 3 keys. Mark the "config" key archived.
    const configKeyB64 = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new (await import('@stellar/stellar-sdk')).Address(CONTRACT_ID).toScAddress(),
        key: storageKeys[1],
        durability: xdr.ContractDataDurability.persistent(),
      }),
    ).toXDR('base64')

    respondWithTTL(mock, CURRENT_LEDGER + 100, new Set([configKeyB64]))

    const res = await getExpiringEntriesForContract(mock, CONTRACT_ID, {
      storageKeys,
      includeCode: false,
    })

    expect(res.contractId).toBe(CONTRACT_ID)
    expect(res.currentLedger).toBe(CURRENT_LEDGER)
    expect(res.entries).toHaveLength(3)
    // live entries are 100 ledgers from expiry → well within the default window
    expect(res.expiringSoon.length).toBe(2)
    expect(res.expiringSoon.every((e) => e.ttlLedgers === 100)).toBe(true)
    expect(res.archived).toHaveLength(1)
    expect(res.archived[0].keyBase64).toBe(configKeyB64)
  })

  it('does not flag entries that are comfortably far from expiry', async () => {
    const mock = baseMock()
    respondWithTTL(mock, CURRENT_LEDGER + DEFAULT_EXPIRING_SOON_LEDGERS + 5_000)

    const res = await getExpiringEntriesForContract(mock, CONTRACT_ID, { includeCode: false })

    expect(res.entries).toHaveLength(1)
    expect(res.expiringSoon).toHaveLength(0)
    expect(res.archived).toHaveLength(0)
  })

  it('chunks large key sets into multiple getLedgerEntries calls', async () => {
    const mock = baseMock()
    respondWithTTL(mock, CURRENT_LEDGER + 10)

    const storageKeys = Array.from({ length: 120 }, (_, i) => nativeToScVal(`k${i}`))
    const res = await getExpiringEntriesForContract(mock, CONTRACT_ID, {
      storageKeys,
      includeInstance: false,
      includeCode: false,
    })

    expect(res.entries).toHaveLength(120)
    // 120 keys / 50 per chunk → 3 calls
    expect(vi.mocked(mock.getLedgerEntries).mock.calls).toHaveLength(3)
  })

  it('reads the instance entry to add the Wasm code key when includeCode is true', async () => {
    const mock = baseMock()
    const wasmHash = Buffer.alloc(32, 9)

    // First call: instance read for tryContractCodeKey.
    vi.mocked(mock.getLedgerEntries)
      .mockResolvedValueOnce({
        entries: [
          {
            val: {
              contractData: () => ({
                val: () => ({
                  instance: () => ({
                    executable: () => ({
                      switch: () => ({ name: 'contractExecutableWasm' }),
                      wasmHash: () => wasmHash,
                    }),
                  }),
                }),
              }),
            },
          },
        ],
      } as never)
      // Second call: the actual TTL scan.
      .mockImplementation((...keys: xdr.LedgerKey[]) =>
        Promise.resolve({
          entries: keys.map((k) => ({ key: k, liveUntilLedgerSeq: CURRENT_LEDGER + 1 })),
          latestLedger: CURRENT_LEDGER,
        } as never),
      )

    const res = await getExpiringEntriesForContract(mock, CONTRACT_ID, { includeCode: true })

    // instance + code = 2 entries
    expect(res.entries).toHaveLength(2)
    const kinds = res.entries.map((e) => xdr.LedgerKey.fromXDR(e.keyBase64, 'base64').switch().name)
    expect(kinds).toContain('contractCode')
  })

  it('rejects an invalid contract id', async () => {
    await expect(getExpiringEntriesForContract(baseMock(), 'not-a-contract')).rejects.toThrow(
      /invalid contract id/,
    )
  })
})

describe('getExpiringEntriesForAccount', () => {
  const ACCOUNT = Keypair.random().publicKey()
  const ISSUER = Keypair.random().publicKey()

  it('reports which classic entries exist and which are missing', async () => {
    const mock = baseMock()
    const usdc = new Asset('USDC', ISSUER)
    const eurc = new Asset('EURC', ISSUER)

    // Return only the account entry + the USDC trustline; EURC is missing.
    vi.mocked(mock.getLedgerEntries).mockImplementation((...keys: xdr.LedgerKey[]) => {
      const entries = keys
        .filter((k) => k.switch().name === 'account' || isTrustlineFor(k, 'USDC'))
        .map((k) => ({ key: k }))
      return Promise.resolve({ entries, latestLedger: CURRENT_LEDGER } as never)
    })

    const res = await getExpiringEntriesForAccount(mock, ACCOUNT, {
      trustlineAssets: [Asset.native(), usdc, eurc],
    })

    expect(res.accountId).toBe(ACCOUNT)
    expect(res.entries).toHaveLength(3) // account + USDC + EURC (native skipped)
    expect(res.entries.find((e) => e.kind === 'account')?.exists).toBe(true)
    expect(res.missing.map((e) => e.label)).toEqual([`EURC:${ISSUER}`])
  })

  it('rejects an invalid account id', async () => {
    await expect(getExpiringEntriesForAccount(baseMock(), 'not-an-account')).rejects.toThrow(
      /invalid account id/,
    )
  })
})

function isTrustlineFor(key: xdr.LedgerKey, code: string): boolean {
  if (key.switch().name !== 'trustline') return false
  try {
    const asset = key.trustLine().asset()
    const alphaNum4 = asset.alphaNum4?.()
    const raw = alphaNum4?.assetCode?.() as Buffer | undefined
    return raw ? raw.toString('utf8').replace(/\0+$/, '') === code : false
  } catch {
    return false
  }
}
