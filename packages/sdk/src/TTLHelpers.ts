import { rpc, xdr } from '@stellar/stellar-sdk'
import { ArchivedLedgerEntry } from './types.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import { asXdrBase64, type XdrBase64 } from './branded-types.js'
import { fetchLedgerEntriesChunked } from './ledgerChunks.js'

/** Default window (ms) during which a fetched latest-ledger sequence is reused. */
export const LATEST_LEDGER_CACHE_MS = 1000

/** Options for {@link queryLedgerTTL}. */
export interface QueryLedgerTTLOptions {
  /** Known current ledger sequence; skips the `getLatestLedger` RPC call entirely. */
  currentLedger?: number
  /** Window (ms) to reuse a cached latest ledger (default {@link LATEST_LEDGER_CACHE_MS}; `0` disables). */
  latestLedgerCacheMs?: number
  /** Keys per `getLedgerEntries` request. */
  chunkSize?: number
  /** Maximum chunk requests in flight. */
  concurrency?: number
}

const latestLedgerCache = new WeakMap<
  ISorobanRpcClient,
  { at: number; sequence: Promise<number> }
>()

/**
 * Returns the latest ledger sequence, sharing one in-flight/cached request per
 * client for `cacheMs` so concurrent TTL queries agree on "now".
 */
export function getCachedLatestLedger(
  server: ISorobanRpcClient,
  cacheMs: number = LATEST_LEDGER_CACHE_MS,
): Promise<number> {
  const now = Date.now()
  const hit = latestLedgerCache.get(server)
  if (hit && cacheMs > 0 && now - hit.at < cacheMs) return hit.sequence
  const sequence = server.getLatestLedger().then((r) => r.sequence)
  latestLedgerCache.set(server, { at: now, sequence })
  sequence.catch(() => latestLedgerCache.delete(server))
  return sequence
}

/** Drops the cached latest ledger for `server` (called by `switchNetwork()`). */
export function invalidateLatestLedgerCache(server: ISorobanRpcClient): void {
  latestLedgerCache.delete(server)
}

/**
 * Average ledger close time in seconds. Used for estimating time remaining
 * before a ledger entry expires.
 */
export const LEDGER_CLOSE_TIME_SECONDS = 5

/**
 * The kind of ledger entry a TTL query was performed against.
 *
 * `contractData` covers persistent/temporary contract storage entries;
 * `contractCode` covers the wasm bytecode entry for a deployed contract
 * (see {@link buildContractCodeKey}); `other` covers any other ledger
 * entry type (e.g. `account`, `trustline`).
 */
export type LedgerKeyEntryType = 'contractData' | 'contractCode' | 'other'

/** Why a queried key has no usable live TTL value. */
export type TTLUnavailableReason =
  'missing' | 'expired' | 'unsupported' | 'rpc_error' | 'ttl_unavailable'

/**
 * Detailed TTL information for a single ledger entry.
 */
export interface LedgerEntryTTLInfo {
  /** Base64-encoded XDR representation of the ledger key. */
  keyBase64: XdrBase64
  /** The kind of ledger entry this key refers to. */
  entryType: LedgerKeyEntryType
  /** Ledger sequence number at which this entry expires, when returned by RPC. */
  liveUntilLedger?: number
  /** Current ledger sequence number at the time of the query. */
  currentLedger: number
  /** Number of ledgers remaining before the entry expires, when available. */
  ttlLedgers?: number
  /** Whether the entry is already archived (expired TTL or not found on-chain). */
  isArchived: boolean
  /** `live` when a usable TTL was returned; otherwise `unavailable`. */
  status: 'live' | 'unavailable'
  /** Reason no current live TTL is available. */
  unavailableReason?: TTLUnavailableReason
  /** Rough estimate of seconds remaining until expiry, based on ~5 s per ledger. */
  estimatedSecondsRemaining?: number
}

/**
 * Determines whether a ledger key refers to a ContractData, ContractCode, or
 * other ledger entry. Used to annotate TTL query results so callers can tell
 * wasm (contract code) entries apart from contract storage entries.
 */
export function getLedgerKeyEntryType(key: xdr.LedgerKey): LedgerKeyEntryType {
  switch (key.switch().name) {
    case 'contractData':
      return 'contractData'
    case 'contractCode':
      return 'contractCode'
    default:
      return 'other'
  }
}

/**
 * Aggregated result from a multi-key TTL query.
 */
export interface TTLQueryResult {
  /** Per-entry TTL information, in the same order as the queried keys. */
  entries: LedgerEntryTTLInfo[]
  /** Current ledger sequence number at the time of the query. */
  currentLedger: number
  /** Unix timestamp (ms) when the query was performed. */
  queriedAt: number
  /** RPC chunks that could not be queried; their entries remain unavailable. */
  failedChunks: Array<{ chunkIndex: number; message: string; keys: XdrBase64[] }>
  /** Convenience flag: true when at least one RPC chunk failed. */
  hasErrors: boolean
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a `LedgerEntryTTLInfo` object for an entry that was not found
 * on-chain (i.e. already archived).
 */
function makeArchivedInfo(
  keyBase64: XdrBase64,
  currentLedger: number,
  entryType: LedgerKeyEntryType,
): LedgerEntryTTLInfo {
  return {
    keyBase64,
    entryType,
    currentLedger,
    isArchived: true,
    status: 'unavailable',
    unavailableReason: 'missing',
  }
}

function makeUnavailableInfo(
  keyBase64: XdrBase64,
  currentLedger: number,
  entryType: LedgerKeyEntryType,
  reason: TTLUnavailableReason,
): LedgerEntryTTLInfo {
  return {
    keyBase64,
    entryType,
    currentLedger,
    isArchived: reason === 'expired',
    status: 'unavailable',
    unavailableReason: reason,
  }
}

/**
 * Builds a `LedgerEntryTTLInfo` object for a live (non-archived) entry.
 */
function makeLiveInfo(
  keyBase64: XdrBase64,
  liveUntilLedger: number,
  currentLedger: number,
  entryType: LedgerKeyEntryType,
): LedgerEntryTTLInfo {
  const ttlLedgers = Math.max(0, liveUntilLedger - currentLedger)
  const isArchived = ttlLedgers === 0
  return {
    keyBase64,
    entryType,
    liveUntilLedger,
    currentLedger,
    ttlLedgers,
    isArchived,
    status: isArchived ? 'unavailable' : 'live',
    unavailableReason: isArchived ? 'expired' : undefined,
    estimatedSecondsRemaining: ttlLedgers * LEDGER_CLOSE_TIME_SECONDS,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Queries the current TTL information for one or more ledger keys.
 *
 * Fetches ledger entries in chunks with bounded concurrency (see
 * {@link fetchLedgerEntriesChunked}). The latest ledger is cached briefly per
 * client, or skipped when `opts.currentLedger` is supplied.
 * Keys not found on-chain are treated as archived.
 *
 * Works identically for `LedgerKeyContractData` and `LedgerKeyContractCode`
 * (wasm) keys: `getLedgerEntries` and `liveUntilLedgerSeq` are reported the
 * same way for both key types, and nothing here branches on key kind — a
 * mixed array of storage and wasm keys is queried and reported together.
 *
 * @param server - Soroban RPC server instance.
 * @param keys   - Ledger keys to query (contract data and/or contract code).
 * @returns Aggregated TTL result including per-entry info and query metadata.
 */
export async function queryLedgerTTL(
  server: ISorobanRpcClient,
  keys: xdr.LedgerKey[],
  opts: QueryLedgerTTLOptions = {},
): Promise<TTLQueryResult> {
  const queriedAt = Date.now()

  const currentLedger =
    opts.currentLedger ?? (await getCachedLatestLedger(server, opts.latestLedgerCacheMs))

  const failedChunks: TTLQueryResult['failedChunks'] = []
  const infoMap = new Map<string, LedgerEntryTTLInfo>()

  // Establish an explicit unavailable result before the RPC lookup.
  for (const key of keys) {
    const keyBase64 = asXdrBase64(key.toXDR('base64'))
    const entryType = getLedgerKeyEntryType(key)
    infoMap.set(
      keyBase64,
      entryType === 'other'
        ? makeUnavailableInfo(keyBase64, currentLedger, entryType, 'unsupported')
        : makeArchivedInfo(keyBase64, currentLedger, entryType),
    )
  }

  const supportedKeys = keys.filter((key) => getLedgerKeyEntryType(key) !== 'other')
  const found = await fetchLedgerEntriesChunked(server, supportedKeys, {
    chunkSize: opts.chunkSize,
    concurrency: opts.concurrency,
    onChunkError: (err, chunkIndex, chunkKeys) => {
      const message = err instanceof Error ? err.message : String(err)
      const failedKeys = chunkKeys.map((key) => asXdrBase64(key.toXDR('base64')))
      failedChunks.push({ chunkIndex, message, keys: failedKeys })
      for (const key of chunkKeys) {
        const keyBase64 = asXdrBase64(key.toXDR('base64'))
        infoMap.set(
          keyBase64,
          makeUnavailableInfo(keyBase64, currentLedger, getLedgerKeyEntryType(key), 'rpc_error'),
        )
      }
      console.warn(`TTLHelpers: getLedgerEntries chunk ${chunkIndex} failed: ${message}`)
    },
  })
  for (const entry of found) {
    const keyBase64 = asXdrBase64(entry.key.toXDR('base64'))
    if (entry.liveUntilLedgerSeq === undefined) {
      infoMap.set(
        keyBase64,
        makeUnavailableInfo(
          keyBase64,
          currentLedger,
          getLedgerKeyEntryType(entry.key),
          'ttl_unavailable',
        ),
      )
      continue
    }
    infoMap.set(
      keyBase64,
      makeLiveInfo(
        keyBase64,
        entry.liveUntilLedgerSeq,
        currentLedger,
        getLedgerKeyEntryType(entry.key),
      ),
    )
  }

  // Preserve original key order
  const entries: LedgerEntryTTLInfo[] = keys.map((key) => {
    const keyBase64 = asXdrBase64(key.toXDR('base64'))

    return infoMap.get(keyBase64)!
  })

  return { entries, currentLedger, queriedAt, failedChunks, hasErrors: failedChunks.length > 0 }
}

/**
 * Queries the current TTL information for a single ledger key.
 *
 * @param server - Soroban RPC server instance.
 * @param key    - The ledger key to query.
 * @returns TTL info for the requested entry.
 */
export async function queryLedgerEntryTTL(
  server: ISorobanRpcClient,
  key: xdr.LedgerKey,
): Promise<LedgerEntryTTLInfo> {
  const result = await queryLedgerTTL(server, [key])
  return result.entries[0]
}

/**
 * Returns the subset of queried ledger entries that are expiring within
 * `ledgersThreshold` ledgers from now (inclusive of already-archived entries).
 *
 * @param server            - Soroban RPC server instance.
 * @param keys              - Ledger keys to query.
 * @param ledgersThreshold  - Maximum number of ledgers remaining to be considered "expiring soon".
 * @returns Entries expiring within the threshold (or already archived).
 */
export async function getExpiringSoonEntries(
  server: ISorobanRpcClient,
  keys: xdr.LedgerKey[],
  ledgersThreshold: number,
): Promise<LedgerEntryTTLInfo[]> {
  const result = await queryLedgerTTL(server, keys)
  return result.entries.filter(
    (entry) =>
      entry.unavailableReason === 'missing' ||
      entry.unavailableReason === 'expired' ||
      (entry.status === 'live' && (entry.ttlLedgers ?? Infinity) <= ledgersThreshold),
  )
}

/**
 * Returns the subset of queried ledger entries that are already archived
 * (expired TTL or not found on-chain), formatted as `ArchivedLedgerEntry`
 * objects compatible with the rest of the SDK.
 *
 * @param server - Soroban RPC server instance.
 * @param keys   - Ledger keys to query.
 * @returns Archived entries as `ArchivedLedgerEntry[]`.
 */
export async function getArchivedEntries(
  server: ISorobanRpcClient,
  keys: xdr.LedgerKey[],
): Promise<ArchivedLedgerEntry[]> {
  const result = await queryLedgerTTL(server, keys)
  return result.entries
    .filter((entry) => entry.isArchived)
    .map((entry) => {
      // Re-derive the original xdr.LedgerKey from the base64 string
      const key = xdr.LedgerKey.fromXDR(entry.keyBase64, 'base64')
      return {
        key,
        keyBase64: entry.keyBase64,
        entryType: entry.entryType,
        liveUntilLedger: entry.liveUntilLedger,
        currentLedger: entry.currentLedger,
        ttlLedgers: entry.ttlLedgers,
      }
    })
}
