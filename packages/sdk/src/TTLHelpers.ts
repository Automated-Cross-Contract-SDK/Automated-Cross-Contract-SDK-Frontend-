import { rpc, xdr } from '@stellar/stellar-sdk'
import { ArchivedLedgerEntry } from './types.js'
import { asXdrBase64, type XdrBase64 } from './branded-types.js'

/**
 * Average ledger close time in seconds. Used for estimating time remaining
 * before a ledger entry expires.
 */
export const LEDGER_CLOSE_TIME_SECONDS = 5

/**
 * Detailed TTL information for a single ledger entry.
 */
export interface LedgerEntryTTLInfo {
  /** Base64-encoded XDR representation of the ledger key. */
  keyBase64: XdrBase64
  /** Ledger sequence number at which this entry expires (0 if archived). */
  liveUntilLedger: number
  /** Current ledger sequence number at the time of the query. */
  currentLedger: number
  /** Number of ledgers remaining before the entry expires (0 if archived/expired). */
  ttlLedgers: number
  /** Whether the entry is already archived (expired TTL or not found on-chain). */
  isArchived: boolean
  /** Rough estimate of seconds remaining until expiry, based on ~5 s per ledger. */
  estimatedSecondsRemaining: number
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
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a `LedgerEntryTTLInfo` object for an entry that was not found
 * on-chain (i.e. already archived).
 */
function makeArchivedInfo(keyBase64: XdrBase64, currentLedger: number): LedgerEntryTTLInfo {
  return {
    keyBase64,
    liveUntilLedger: 0,
    currentLedger,
    ttlLedgers: 0,
    isArchived: true,
    estimatedSecondsRemaining: 0,
  }
}

/**
 * Builds a `LedgerEntryTTLInfo` object for a live (non-archived) entry.
 */
function makeLiveInfo(
  keyBase64: XdrBase64,
  liveUntilLedger: number,
  currentLedger: number,
): LedgerEntryTTLInfo {
  const ttlLedgers = Math.max(0, liveUntilLedger - currentLedger)
  const isArchived = ttlLedgers === 0
  return {
    keyBase64,
    liveUntilLedger,
    currentLedger,
    ttlLedgers,
    isArchived,
    estimatedSecondsRemaining: ttlLedgers * LEDGER_CLOSE_TIME_SECONDS,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Queries the current TTL information for one or more ledger keys.
 *
 * Fetches ledger entries in chunks of 50 to stay within RPC limits.
 * Keys not found on-chain are treated as archived.
 *
 * @param server - Soroban RPC server instance.
 * @param keys   - Ledger keys to query.
 * @returns Aggregated TTL result including per-entry info and query metadata.
 */
export async function queryLedgerTTL(
  server: ISorobanRpcClient,
  keys: xdr.LedgerKey[],
): Promise<TTLQueryResult> {
  const queriedAt = Date.now()

  const latestLedgerResponse = await server.getLatestLedger()
  const currentLedger = latestLedgerResponse.sequence

  // Build a map from keyBase64 → LedgerEntryTTLInfo for fast lookup
  const infoMap = new Map<string, LedgerEntryTTLInfo>()

  // Pre-populate all keys as archived; overwrite if found on-chain
  for (const key of keys) {
    const keyBase64 = asXdrBase64(key.toXDR('base64'))
    infoMap.set(keyBase64, makeArchivedInfo(keyBase64, currentLedger))
  }

  const chunkSize = 50
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize)
    try {
      const result = await server.getLedgerEntries(...chunk)
      if (result.entries) {
        for (const entry of result.entries) {
          const keyBase64 = asXdrBase64(entry.key.toXDR('base64'))
          const liveUntilLedger = entry.liveUntilLedgerSeq ?? 0
          infoMap.set(keyBase64, makeLiveInfo(keyBase64, liveUntilLedger, currentLedger))
        }
      }
    } catch (err) {
      // On network error the pre-populated archived entries remain in the map.
      console.warn('TTLHelpers: getLedgerEntries chunk failed, treating keys as archived:', err)
    }
  }

  // Preserve original key order
  const entries: LedgerEntryTTLInfo[] = keys.map((key) => {
    const keyBase64 = asXdrBase64(key.toXDR('base64'))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return infoMap.get(keyBase64)!
  })

  return { entries, currentLedger, queriedAt }
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
    (entry) => entry.isArchived || entry.ttlLedgers <= ledgersThreshold,
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
      return { key, keyBase64: entry.keyBase64 }
    })
}
