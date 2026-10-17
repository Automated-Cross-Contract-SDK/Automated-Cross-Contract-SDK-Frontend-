import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Keypair, xdr, Address } from '@stellar/stellar-sdk'
import {
  queryLedgerTTL,
  getExpiringSoonEntries,
  getArchivedEntries,
  LEDGER_CLOSE_TIME_SECONDS,
  DEFAULT_TTL_WARNING_WINDOW_LEDGERS,
} from '../TTLHelpers.js'
import type { ISorobanRpcClient } from '../RpcClient.js'
import { SYSTEM_RUNTIME } from '../runtime.js'

const CURRENT_LEDGER = 1_000

function dataKey(i: number): xdr.LedgerKey {
  const contract = Address.contract(Buffer.alloc(32, 7)).toScAddress()
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract,
      key: xdr.ScVal.scvU32(i),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  )
}

function codeKey(i: number): xdr.LedgerKey {
  return xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, i) }))
}

function accountKey(): xdr.LedgerKey {
  return xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.random().xdrPublicKey() }),
  )
}

const b64 = (k: xdr.LedgerKey) => k.toXDR('base64')

/**
 * Builds a mock RPC client whose getLedgerEntries answers from `liveUntil`
 * (keyBase64 → liveUntilLedgerSeq). Keys absent from the map are omitted from
 * the response, as the real RPC does for archived/missing entries.
 */
function mockServer(
  liveUntil: Map<string, number | undefined>,
  opts: { failOnCall?: Set<number> } = {},
) {
  let call = 0
  const getLedgerEntries = vi.fn(async (...keys: xdr.LedgerKey[]) => {
    const n = call++
    if (opts.failOnCall?.has(n)) throw new Error(`chunk ${n} failed`)
    return {
      latestLedger: CURRENT_LEDGER,
      entries: keys
        .filter((k) => liveUntil.has(b64(k)))
        .map((k) => ({ key: k, liveUntilLedgerSeq: liveUntil.get(b64(k)) })),
    }
  })
  const server = {
    getLatestLedger: vi.fn(async () => ({ sequence: CURRENT_LEDGER })),
    getLedgerEntries,
  } as unknown as ISorobanRpcClient
  return { server, getLedgerEntries }
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('queryLedgerTTL', () => {
  it('uses the injected clock for query metadata and latest-ledger cache expiry', async () => {
    const key = dataKey(41)
    let now = 10_000
    const runtime = { ...SYSTEM_RUNTIME, now: () => now }
    const { server } = mockServer(new Map())

    const first = await queryLedgerTTL(server, [key], { runtime })
    const cached = await queryLedgerTTL(server, [key], { runtime })
    now += 1_001
    const refreshed = await queryLedgerTTL(server, [key], { runtime })

    expect(first.queriedAt).toBe(10_000)
    expect(cached.queriedAt).toBe(10_000)
    expect(refreshed.queriedAt).toBe(11_001)
    expect(server.getLatestLedger).toHaveBeenCalledTimes(2)
  })

  it('returns empty entries for no keys and makes no ledger-entry calls', async () => {
    const { server, getLedgerEntries } = mockServer(new Map())
    const res = await queryLedgerTTL(server, [])
    expect(res.entries).toEqual([])
    expect(res.currentLedger).toBe(CURRENT_LEDGER)
    expect(getLedgerEntries).not.toHaveBeenCalled()
  })

  it('reports mixed live and archived keys in original order', async () => {
    const live = dataKey(1)
    const missing = dataKey(2)
    const code = codeKey(3)
    const { server } = mockServer(
      new Map([
        [b64(live), CURRENT_LEDGER + 20],
        [b64(code), CURRENT_LEDGER + 5],
      ]),
    )

    const { entries } = await queryLedgerTTL(server, [missing, live, code])

    expect(entries.map((e) => e.keyBase64)).toEqual([b64(missing), b64(live), b64(code)])
    expect(entries[0]).toMatchObject({
      isArchived: true,
      status: 'unavailable',
      unavailableReason: 'missing',
      entryType: 'contractData',
    })
    expect(entries[1]).toMatchObject({
      isArchived: false,
      status: 'live',
      liveUntilLedger: CURRENT_LEDGER + 20,
      ttlLedgers: 20,
      estimatedSecondsRemaining: 20 * LEDGER_CLOSE_TIME_SECONDS,
      currentLedger: CURRENT_LEDGER,
    })
    expect(entries[2]).toMatchObject({
      isArchived: false,
      status: 'near-expiry',
      ttlLedgers: 5,
      entryType: 'contractCode',
    })
  })

  it('reports non-contract keys as unsupported without querying them', async () => {
    const acct = accountKey()
    const { server, getLedgerEntries } = mockServer(new Map([[b64(acct), CURRENT_LEDGER + 1]]))
    const { entries } = await queryLedgerTTL(server, [acct])
    expect(entries[0]).toMatchObject({
      entryType: 'other',
      status: 'unavailable',
      unavailableReason: 'unsupported',
      isArchived: false,
    })
    expect(getLedgerEntries).not.toHaveBeenCalled()
  })

  it('reports an entry at its expiry ledger as unavailable and archived', async () => {
    const k = dataKey(1)
    const { server } = mockServer(new Map([[b64(k), CURRENT_LEDGER]]))
    const { entries } = await queryLedgerTTL(server, [k])
    expect(entries[0]).toMatchObject({
      isArchived: true,
      status: 'unavailable',
      unavailableReason: 'expired',
      ttlLedgers: 0,
      liveUntilLedger: CURRENT_LEDGER,
    })
  })

  it('reports an expired entry as unavailable and clamps ttl to 0', async () => {
    const k = dataKey(1)
    const { server } = mockServer(new Map([[b64(k), CURRENT_LEDGER - 50]]))
    const { entries } = await queryLedgerTTL(server, [k])
    expect(entries[0]).toMatchObject({
      isArchived: true,
      unavailableReason: 'expired',
      ttlLedgers: 0,
      estimatedSecondsRemaining: 0,
    })
  })

  it('reports missing liveUntilLedgerSeq as unavailable without calling it archived', async () => {
    const k = dataKey(1)
    const { server } = mockServer(new Map([[b64(k), undefined]]))
    const { entries } = await queryLedgerTTL(server, [k])
    expect(entries[0]).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'ttl_unavailable',
      isArchived: false,
    })
  })

  it('marks entries within the warning window as near-expiry', async () => {
    const k = dataKey(1)
    const { server } = mockServer(new Map([[b64(k), CURRENT_LEDGER + 1]]))
    const { entries } = await queryLedgerTTL(server, [k], { warningWindowLedgers: 1 })
    expect(entries[0]).toMatchObject({ status: 'near-expiry', isArchived: false, ttlLedgers: 1 })
  })

  it('marks entries beyond the warning window as healthy', async () => {
    const k = dataKey(1)
    const { server } = mockServer(new Map([[b64(k), CURRENT_LEDGER + 2]]))
    const { entries } = await queryLedgerTTL(server, [k], { warningWindowLedgers: 1 })
    expect(entries[0].status).toBe('healthy')
  })

  it('uses the default warning window and rejects invalid values', async () => {
    const k = dataKey(1)
    const { server } = mockServer(
      new Map([[b64(k), CURRENT_LEDGER + DEFAULT_TTL_WARNING_WINDOW_LEDGERS]]),
    )
    expect((await queryLedgerTTL(server, [k])).entries[0].status).toBe('near-expiry')
    await expect(queryLedgerTTL(server, [k], { warningWindowLedgers: -1 })).rejects.toThrow(
      'warningWindowLedgers must be a non-negative integer',
    )
  })

  it('splits requests into chunks of 50', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => dataKey(i))
    const { server, getLedgerEntries } = mockServer(
      new Map(keys.map((k) => [b64(k), CURRENT_LEDGER + 10])),
    )
    const { entries } = await queryLedgerTTL(server, keys)
    expect(getLedgerEntries).toHaveBeenCalledTimes(3)
    expect(getLedgerEntries.mock.calls.map((c) => c.length)).toEqual([50, 50, 20])
    expect(entries.every((e) => !e.isArchived)).toBe(true)
  })

  it('reports every key in a failed chunk as unavailable, keeping other chunks', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => dataKey(i))
    const { server } = mockServer(new Map(keys.map((k) => [b64(k), CURRENT_LEDGER + 10])), {
      failOnCall: new Set([1]),
    })

    const { entries, failedChunks, hasErrors } = await queryLedgerTTL(server, keys)

    expect(entries.slice(0, 50).every((e) => !e.isArchived)).toBe(true)
    expect(
      entries
        .slice(50, 100)
        .every(
          (e) => !e.isArchived && e.unavailableReason === 'rpc_error' && e.ttlLedgers === undefined,
        ),
    ).toBe(true)
    expect(entries.slice(100).every((e) => !e.isArchived)).toBe(true)
    expect(failedChunks).toHaveLength(1)
    expect(hasErrors).toBe(true)
    expect(failedChunks[0].keys).toHaveLength(50)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('reports every key as unavailable when every chunk fails', async () => {
    const keys = [dataKey(1), codeKey(2)]
    const { server } = mockServer(new Map(keys.map((k) => [b64(k), CURRENT_LEDGER + 10])), {
      failOnCall: new Set([0]),
    })
    const { entries } = await queryLedgerTTL(server, keys)
    expect(entries.every((e) => !e.isArchived && e.status === 'unavailable')).toBe(true)
    expect(entries.map((e) => e.unavailableReason)).toEqual(['rpc_error', 'rpc_error'])
    expect(entries.map((e) => e.entryType)).toEqual(['contractData', 'contractCode'])
  })

  it('handles a response with no entries field', async () => {
    const k = dataKey(1)
    const server = {
      getLatestLedger: vi.fn(async () => ({ sequence: CURRENT_LEDGER })),
      getLedgerEntries: vi.fn(async () => ({ latestLedger: CURRENT_LEDGER })),
    } as unknown as ISorobanRpcClient
    const { entries } = await queryLedgerTTL(server, [k])
    expect(entries[0].isArchived).toBe(true)
  })

  it('propagates getLatestLedger failures', async () => {
    const server = {
      getLatestLedger: vi.fn(async () => {
        throw new Error('rpc down')
      }),
      getLedgerEntries: vi.fn(),
    } as unknown as ISorobanRpcClient
    await expect(queryLedgerTTL(server, [dataKey(1)])).rejects.toThrow('rpc down')
  })
})

describe('getExpiringSoonEntries', () => {
  const THRESHOLD = 100
  const below = dataKey(1) // ttl 99
  const exact = dataKey(2) // ttl 100
  const above = dataKey(3) // ttl 101
  const expired = dataKey(4) // liveUntil in the past
  const missing = dataKey(5) // not on chain

  const liveUntil = new Map<string, number | undefined>([
    [b64(below), CURRENT_LEDGER + THRESHOLD - 1],
    [b64(exact), CURRENT_LEDGER + THRESHOLD],
    [b64(above), CURRENT_LEDGER + THRESHOLD + 1],
    [b64(expired), CURRENT_LEDGER - 1],
  ])

  it('includes entries below and exactly at the threshold, excludes those above', async () => {
    const { server } = mockServer(liveUntil)
    const res = await getExpiringSoonEntries(server, [below, exact, above], THRESHOLD)
    expect(res.map((e) => e.keyBase64)).toEqual([b64(below), b64(exact)])
  })

  it('always includes expired and missing (archived) entries', async () => {
    const { server } = mockServer(liveUntil)
    const res = await getExpiringSoonEntries(server, [above, expired, missing], THRESHOLD)
    expect(res.map((e) => e.keyBase64)).toEqual([b64(expired), b64(missing)])
  })

  it('with threshold 0 returns only archived entries', async () => {
    const { server } = mockServer(liveUntil)
    const res = await getExpiringSoonEntries(server, [below, exact, above, expired, missing], 0)
    expect(res.every((e) => e.isArchived)).toBe(true)
    expect(res).toHaveLength(2)
  })

  it('excludes keys from a failed chunk instead of treating them as archived', async () => {
    const { server } = mockServer(liveUntil, { failOnCall: new Set([0]) })
    const res = await getExpiringSoonEntries(server, [above], THRESHOLD)
    expect(res).toHaveLength(0)
  })
})

describe('getArchivedEntries', () => {
  it('returns only archived entries with round-tripped LedgerKeys', async () => {
    const live = dataKey(1)
    const expired = dataKey(2)
    const missing = codeKey(3)
    const { server } = mockServer(
      new Map([
        [b64(live), CURRENT_LEDGER + 10],
        [b64(expired), CURRENT_LEDGER],
      ]),
    )

    const res = await getArchivedEntries(server, [live, expired, missing])

    expect(res.map((e) => e.keyBase64)).toEqual([b64(expired), b64(missing)])
    for (const e of res) expect(e.key.toXDR('base64')).toBe(e.keyBase64)
    expect(res[1].key.switch().name).toBe('contractCode')
    expect(res.map((entry) => entry.entryType)).toEqual(['contractData', 'contractCode'])
    expect(res[1]).toMatchObject({ currentLedger: CURRENT_LEDGER })
    expect(res[1].liveUntilLedger).toBeUndefined()
    expect(res[1].ttlLedgers).toBeUndefined()
  })

  it('returns an empty array when every key is live', async () => {
    const keys = [dataKey(1), dataKey(2)]
    const { server } = mockServer(new Map(keys.map((k) => [b64(k), CURRENT_LEDGER + 1])))
    expect(await getArchivedEntries(server, keys)).toEqual([])
  })

  it('does not return keys of a failed chunk as confirmed archived', async () => {
    const keys = Array.from({ length: 60 }, (_, i) => dataKey(i))
    const { server } = mockServer(new Map(keys.map((k) => [b64(k), CURRENT_LEDGER + 10])), {
      failOnCall: new Set([0]),
    })
    const res = await getArchivedEntries(server, keys)
    expect(res).toEqual([])
  })
})
