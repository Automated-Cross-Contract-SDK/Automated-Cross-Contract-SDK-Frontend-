import { Address, rpc, Transaction } from '@stellar/stellar-sdk'
import { xdr } from '@stellar/stellar-sdk'
import { ArchivedLedgerEntry, SimulateResponse } from './types.js'
import { getLedgerKeyEntryType } from './TTLHelpers.js'
import { asXdrBase64, type ContractIdHex, type HexString } from './branded-types.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import { ResurrectError } from './errors.js'
import { serializeLedgerKey } from './LedgerKey.js'
import { createDebugger } from './Debug.js'
import { LEDGER_ENTRY_CHUNK_SIZE, LEDGER_ENTRY_CONCURRENCY } from './constants.js'
import { IncompleteFootprintError, readSimulationFootprint } from './SimulationFootprint.js'

const debug = createDebugger('archiver')

/** Best-effort entry type; `undefined` when the key cannot be inspected. */
function tryGetLedgerKeyEntryType(key: xdr.LedgerKey): ArchivedLedgerEntry['entryType'] {
  try {
    return getLedgerKeyEntryType(key)
  } catch {
    return undefined
  }
}

function compareArchivedEntries(a: ArchivedLedgerEntry, b: ArchivedLedgerEntry): number {
  return a.keyBase64 < b.keyBase64 ? -1 : a.keyBase64 > b.keyBase64 ? 1 : 0
}

/**
 * Type guard — returns true if the simulation response indicates archived
 * ledger entries that need restoration.
 *
 * @param response - A {@link SimulateResponse} from `simulateTransaction`.
 * @returns `true`, narrowing `response` to
 *   `SimulateTransactionRestoreResponse`, if a restore is required.
 * @see {@link extractArchivedKeys} to get the archived keys once this
 *   returns `true`.
 */
export function isRestoreResponse(
  response: SimulateResponse,
): response is rpc.Api.SimulateTransactionRestoreResponse {
  return rpc.Api.isSimulationRestore(response)
}

/**
 * Type guard — returns true if the simulation response indicates a
 * successful simulation with no restore required.
 *
 * @param response - A {@link SimulateResponse} from `simulateTransaction`.
 * @returns `true`, narrowing `response` to
 *   `SimulateTransactionSuccessResponse`, if simulation succeeded and no
 *   restore is needed.
 * @see {@link extractFootprintFromSuccess} to read the footprint from a
 *   success response.
 */
export function isSuccessResponse(
  response: SimulateResponse,
): response is rpc.Api.SimulateTransactionSuccessResponse {
  return rpc.Api.isSimulationSuccess(response)
}

/**
 * Type guard — returns true if the simulation response indicates an error.
 *
 * @param response - A {@link SimulateResponse} from `simulateTransaction`.
 * @returns `true`, narrowing `response` to
 *   `SimulateTransactionErrorResponse`, if simulation failed.
 */
export function isErrorResponse(
  response: SimulateResponse,
): response is rpc.Api.SimulateTransactionErrorResponse {
  return rpc.Api.isSimulationError(response)
}

/**
 * Archived entries that a simulated call restores by itself.
 *
 * Since protocol 23 (CAP-0066) RPC no longer returns a restore preamble for
 * contract calls. It returns a normal success whose resources list, by index
 * into the read-write footprint, the archived entries that are restored in
 * place when the transaction executes.
 */
export function extractAutoRestoredKeys(response: SimulateResponse): ArchivedLedgerEntry[] {
  if (!isSuccessResponse(response) || isRestoreResponse(response)) return []
  const data: xdr.SorobanTransactionData | undefined = response.transactionData?.build?.()
  return archivedKeysInResources(data)
}

/** Entries a transaction's own resources mark for automatic restoration. */
export function archivedKeysInResources(
  data: xdr.SorobanTransactionData | undefined,
): ArchivedLedgerEntry[] {
  if (data?.ext?.type !== 'resourceExt') return []
  const { readWrite } = data.resources.footprint
  return data.ext.resourceExt.archivedSorobanEntries
    .map((index) => readWrite[index])
    .filter((key) => key !== undefined)
    .map((key) => ({
      key,
      keyBase64: serializeLedgerKey(key),
      entryType: getLedgerKeyEntryType(key),
    }))
    .sort(compareArchivedEntries)
}

/**
 * Extracts the list of archived ledger keys from a restore simulation response.
 * The read-write entries in the transaction footprint represent the keys that
 * need to be restored.
 *
 * Covers both `LedgerKeyContractData` and `LedgerKeyContractCode` entries —
 * Soroban's `restoreFootprint` operates on whatever the transaction's
 * read-write footprint contains, wasm blobs included, and this function
 * copies that footprint verbatim without filtering by key discriminant. A
 * transaction that deploys/upgrades a contract and also touches its storage
 * can therefore need both key types restored in the same call.
 *
 * @param response - A restore simulation response, as narrowed by
 *   {@link isRestoreResponse}.
 * @returns Array of {@link ArchivedLedgerEntry}. Empty if the response has
 *   `_parsed: false` or the footprint could not be read (a warning is
 *   logged via `console.warn` in the former case).
 *   Results are sorted by serialized ledger-key XDR, independent of
 *   footprint ordering.
 *
 * @example
 * ```ts
 * const sim = await server.simulateTransaction(tx)
 * if (isRestoreResponse(sim)) {
 *   const archived = extractArchivedKeys(sim)
 * }
 * ```
 */
export function extractArchivedKeys(
  response: rpc.Api.SimulateTransactionRestoreResponse,
): ArchivedLedgerEntry[] {
  const { readWrite } = readSimulationFootprint(response, { requireReadWrite: true })
  const keys: ArchivedLedgerEntry[] = []
  try {
    for (const ledgerKey of readWrite) {
      const entry: ArchivedLedgerEntry = {
        key: ledgerKey,
        keyBase64: serializeLedgerKey(ledgerKey),
      }
      const entryType = tryGetLedgerKeyEntryType(ledgerKey)
      if (entryType) entry.entryType = entryType
      keys.push(entry)
    }
  } catch (error) {
    throw new IncompleteFootprintError(
      'invalid-footprint',
      `a read-write ledger key could not be serialized: ${error instanceof Error ? error.message : String(error)}.`,
    )
  }

  keys.sort(compareArchivedEntries)

  debug('extractArchivedKeys: %d archived key(s) in restore footprint', keys.length)
  return keys
}

/**
 * Extracts the read-only and read-write ledger keys from a success simulation
 * response footprint.
 *
 * @param response - A successful simulation response, as narrowed by
 *   {@link isSuccessResponse}.
 * @returns `{ readOnly, readWrite }` ledger key arrays. Both are empty if
 *   the response has `_parsed: false` or the footprint could not be read.
 * @see {@link detectArchivedEntries}, which typically consumes the
 *   `readWrite` keys returned here.
 */
export function extractFootprintFromSuccess(response: rpc.Api.SimulateTransactionSuccessResponse): {
  readOnly: xdr.LedgerKey[]
  readWrite: xdr.LedgerKey[]
} {
  return readSimulationFootprint(response)
}

/**
 * Tuning options for chunked, parallel archived-entry detection.
 *
 * @see {@link detectArchivedEntries}
 */
export interface DetectArchivedEntriesOptions {
  /**
   * Ledger keys per `getLedgerEntries` request. Defaults to
   * {@link LEDGER_ENTRY_CHUNK_SIZE}. Values below 1 fall back to the default.
   */
  chunkSize?: number
  /**
   * Chunk requests kept in flight at once. Defaults to
   * {@link LEDGER_ENTRY_CONCURRENCY}. Values below 1 fall back to the default.
   */
  concurrency?: number
}

/**
 * Splits ledger keys into fixed-size chunks.
 */
function chunkKeys(ledgerKeys: xdr.LedgerKey[], chunkSize: number): xdr.LedgerKey[][] {
  const chunks: xdr.LedgerKey[][] = []
  for (let i = 0; i < ledgerKeys.length; i += chunkSize) {
    chunks.push(ledgerKeys.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * Resolves one chunk of keys to the archived entries it contains. A failed
 * request conservatively yields every key in the chunk.
 */
async function detectArchivedChunk(
  server: ISorobanRpcClient,
  chunk: xdr.LedgerKey[],
  chunkIndex: number,
): Promise<ArchivedLedgerEntry[]> {
  let result: rpc.Api.GetLedgerEntriesResponse
  try {
    result = await server.getLedgerEntries(...chunk)
  } catch (err) {
    debug('detectArchivedEntries: chunk %d failed', chunkIndex, err)
    throw new ResurrectError(
      'ARCHIVE_DETECTION_BATCH_FAILED',
      `Could not determine archive status: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // RPC returns archived entries with an expired TTL (0 once evicted). A key
  // that is absent does not exist, so there is nothing to restore.
  const archivedKeys = new Set<string>()
  for (const entry of result.entries ?? []) {
    const { liveUntilLedgerSeq } = entry
    if (liveUntilLedgerSeq !== undefined && liveUntilLedgerSeq < result.latestLedger) {
      archivedKeys.add(entry.key.toXDR('base64'))
    }
  }
  return chunk
    .map((key) => ({
      key,
      keyBase64: asXdrBase64(key.toXDR('base64')),
      entryType: getLedgerKeyEntryType(key),
    }))
    .filter(({ key, keyBase64 }) => archivedKeys.has(keyBase64) && isRestorable(key))
}

/** Only contract code and persistent contract data can be archived and restored. */
function isRestorable(key: xdr.LedgerKey): boolean {
  return (
    key.type === 'contractCode' ||
    (key.type === 'contractData' && key.contractData.durability.name === 'persistent')
  )
}

/**
 * Queries the Soroban RPC server to determine which of the given ledger keys
 * correspond to archived (non-existent / expired) entries.
 *
 * Keys are fetched in chunks (50 by default), and several chunks are requested
 * in parallel, so a large footprint costs roughly
 * `ceil(chunks / concurrency)` round trips rather than one per chunk. If a
 * chunk request fails (network error, rate-limit, etc.), every key in that
 * chunk is conservatively treated as archived to avoid false negatives.
 *
 * @param server - Soroban RPC server instance.
 * @param ledgerKeys - Ledger keys to check (typically the read-write
 *   footprint of a transaction).
 * @param options - Optional {@link DetectArchivedEntriesOptions} overriding
 *   chunk size and request concurrency.
 * @returns Array of {@link ArchivedLedgerEntry} for keys that are missing
 *   from `getLedgerEntries` results (i.e. archived), or that could not be
 *   verified due to a request error. Entries are sorted by serialized
 *   ledger-key XDR, independent of input and RPC response ordering.
 * @see {@link detectArchivedKeysViaDirect}, which wraps this with the
 *   simulate → extract-footprint steps.
 */
export async function detectArchivedEntries(
  server: ISorobanRpcClient,
  ledgerKeys: xdr.LedgerKey[],
  options: DetectArchivedEntriesOptions = {},
): Promise<ArchivedLedgerEntry[]> {
  if (ledgerKeys.length === 0) {
    return []
  }

  const chunkSize =
    options.chunkSize && options.chunkSize >= 1 ? options.chunkSize : LEDGER_ENTRY_CHUNK_SIZE
  const concurrency =
    options.concurrency && options.concurrency >= 1 ? options.concurrency : LEDGER_ENTRY_CONCURRENCY

  const chunks = chunkKeys(ledgerKeys, chunkSize)

  debug(
    'detectArchivedEntries: checking %d ledger key(s) in %d chunk(s) of %d, %d in flight',
    ledgerKeys.length,
    chunks.length,
    chunkSize,
    concurrency,
  )

  // Results are collected per chunk index so the output order stays stable
  // regardless of which requests settle first.
  const results: ArchivedLedgerEntry[][] = new Array(chunks.length)
  let nextChunk = 0

  const worker = async (): Promise<void> => {
    while (nextChunk < chunks.length) {
      const index = nextChunk++
      results[index] = await detectArchivedChunk(server, chunks[index], index)
    }
  }

  const workerCount = Math.min(concurrency, chunks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const archived = results.flat().sort(compareArchivedEntries)
  debug('detectArchivedEntries: %d of %d key(s) archived', archived.length, ledgerKeys.length)
  return archived
}

/**
 * Detects archived keys by simulating the transaction and extracting
 * archived entries from the footprint.
 *
 * @param server - Soroban RPC server instance.
 * @param transaction - The transaction to simulate.
 * @returns Array of {@link ArchivedLedgerEntry} — empty if the simulation
 *   does not indicate a restore is needed.
 * @see {@link detectArchivedKeysViaDirect} for the alternative
 *   direct-ledger-query strategy.
 */
export async function detectArchivedKeysViaSimulation(
  server: ISorobanRpcClient,
  transaction: Transaction,
): Promise<ArchivedLedgerEntry[]> {
  const response = await server.simulateTransaction(transaction)

  if (isRestoreResponse(response)) {
    return extractArchivedKeys(response)
  }

  if (isSuccessResponse(response)) return extractAutoRestoredKeys(response)
  if (isErrorResponse(response)) return []
  throw new IncompleteFootprintError(
    'unrecognized-response',
    'the RPC response is not a recognized success, error, or restore response.',
  )
}

/**
 * Detects archived keys by querying the ledger directly for keys that
 * appear in a success simulation footprint.
 *
 * This approach first simulates the transaction in success mode (no restore
 * needed), extracts the footprint keys, then queries the ledger to find
 * which ones are archived.
 *
 * @param server - Soroban RPC server instance.
 * @param transaction - The transaction to simulate and check.
 * @param options - Optional {@link DetectArchivedEntriesOptions} forwarded to
 *   {@link detectArchivedEntries}, for tuning large footprints.
 * @returns Array of {@link ArchivedLedgerEntry} found via direct ledger
 *   lookup.
 * @throws {Error} If the simulation itself fails, or if the simulation
 *   already indicates a restore is needed (the simulation-based `restore`
 *   response is a stronger signal — call {@link detectArchivedKeysViaSimulation}
 *   or {@link isRestoreResponse} first).
 * @see {@link detectArchivedKeysViaSimulation} for the default,
 *   simulation-based strategy (`archiveDetectionMethod: 'simulation'`).
 */
export async function detectArchivedKeysViaDirect(
  server: ISorobanRpcClient,
  transaction: Transaction,
  options: DetectArchivedEntriesOptions = {},
): Promise<ArchivedLedgerEntry[]> {
  const response = await server.simulateTransaction(transaction)

  if (isErrorResponse(response)) {
    throw new Error(`Simulation error: ${response.error}`)
  }

  if (isRestoreResponse(response)) {
    throw new Error('Archived entries already detected via simulation restore response')
  }

  if (!isSuccessResponse(response)) {
    throw new IncompleteFootprintError(
      'unrecognized-response',
      'the RPC response is not a recognized success, error, or restore response.',
    )
  }

  const { readOnly, readWrite } = extractFootprintFromSuccess(response)
  return detectArchivedEntries(server, [...readOnly, ...readWrite], options)
}

/**
 * Builds a ContractData ledger key for a given contract ID and storage key.
 * This is used to query specific contract data entries on the ledger.
 *
 * @param contractId - The Stellar contract ID as a hex string (e.g. `"deadbeef..."`).
 *   Use {@link asContractIdHex} to cast from a plain string at the call site.
 * @param key - The storage key as an xdr.ScVal.
 * @param keyType - The durability of the storage entry (persistent or temporary).
 * @returns An xdr.LedgerKey for the ContractData entry.
 */
export function buildContractDataKey(
  contractId: ContractIdHex | string,
  key: xdr.ScVal,
  keyType: 'persistent' | 'temporary' = 'persistent',
): xdr.LedgerKey {
  // Convert hex contract ID string to bytes
  const contractBytes = new Uint8Array(
    (contractId.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)),
  )

  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.contract(contractBytes).toScAddress(),
      key,
      durability:
        keyType === 'temporary'
          ? xdr.ContractDataDurability.temporary
          : xdr.ContractDataDurability.persistent,
    }),
  )
}

/**
 * Checks whether a specific contract data entry is archived (expired / not found
 * on the ledger). This is a targeted utility for dApp developers who want to
 * check specific storage slots without simulating a full transaction.
 *
 * @param server - Soroban RPC server instance.
 * @param contractId - The Stellar contract ID as a hex string.
 *   Use {@link asContractIdHex} to cast from a plain string at the call site.
 * @param key - The storage key as an xdr.ScVal.
 * @param keyType - The durability of the storage entry (persistent or temporary).
 * @returns `true` if the entry is archived (not found), `false` if it exists.
 *
 * @example
 * ```ts
 * import { xdr } from '@stellar/stellar-sdk'
 * import { asContractIdHex } from '@soroban-resurrect/sdk'
 * const isArchived = await checkArchivedContractData(
 *   server,
 *   asContractIdHex('CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'),
 *   xdr.ScVal.scvSymbol('Balance'),
 *   'persistent',
 * )
 * ```
 */
export async function checkArchivedContractData(
  server: ISorobanRpcClient,
  contractId: ContractIdHex | string,
  key: xdr.ScVal,
  keyType: 'persistent' | 'temporary' = 'persistent',
): Promise<boolean> {
  const ledgerKey = buildContractDataKey(contractId, key, keyType)
  const archived = await detectArchivedEntries(server, [ledgerKey])
  return archived.length > 0
}

/**
 * Retrieves a specific contract data entry from the ledger.
 * Returns the ledger entry data if it exists, or `null` if archived / not found.
 *
 * @param server - Soroban RPC server instance.
 * @param contractId - The Stellar contract ID as a hex string.
 *   Use {@link asContractIdHex} to cast from a plain string at the call site.
 * @param key - The storage key as an xdr.ScVal.
 * @param keyType - The durability of the storage entry (persistent or temporary).
 * @returns The ledger entry if found, otherwise `null`.
 *
 * @example
 * ```ts
 * import { xdr } from '@stellar/stellar-sdk'
 * import { asContractIdHex } from '@soroban-resurrect/sdk'
 * const entry = await getContractDataEntry(
 *   server,
 *   asContractIdHex('CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'),
 *   xdr.ScVal.scvSymbol('Balance'),
 * )
 * if (entry) {
 *   console.log('Entry exists:', entry.key.toXDR('base64'))
 * }
 * ```
 */
export async function getContractDataEntry(
  server: ISorobanRpcClient,
  contractId: ContractIdHex | string,
  key: xdr.ScVal,
  keyType: 'persistent' | 'temporary' = 'persistent',
): Promise<rpc.Api.LedgerEntryResult | null> {
  const ledgerKey = buildContractDataKey(contractId, key, keyType)

  try {
    const result = await server.getLedgerEntries(ledgerKey)
    const entry = result.entries?.[0]
    if (!entry) return null
    // RPC still returns archived entries, with an expired TTL.
    const { liveUntilLedgerSeq } = entry
    const archived = liveUntilLedgerSeq !== undefined && liveUntilLedgerSeq < result.latestLedger
    return archived ? null : entry
  } catch {
    return null
  }
}

/**
 * Builds a ContractCode ledger key for a given wasm hash. ContractCode
 * entries store the wasm bytecode for a deployed contract and, like
 * ContractData entries, expire and can be restored via `restoreFootprint`.
 *
 * @param wasmHash - The wasm hash as a 64-char hex string (as returned by
 *   `Operation.uploadContractWasm`/`installContractWasm` responses), or a
 *   raw `Uint8Array`.
 * @returns An xdr.LedgerKey for the ContractCode entry.
 *
 * @example
 * ```ts
 * const key = buildContractCodeKey(wasmHashHex)
 * const archived = await checkArchivedContractCode(server, wasmHashHex)
 * ```
 */
export function buildContractCodeKey(wasmHash: HexString | string | Uint8Array): xdr.LedgerKey {
  const hash =
    typeof wasmHash === 'string'
      ? new Uint8Array((wasmHash.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)))
      : wasmHash

  const contractCode = new xdr.LedgerKeyContractCode({ hash })

  return xdr.LedgerKey.contractCode(contractCode)
}

/**
 * Checks whether a contract's wasm (ContractCode) ledger entry is archived
 * (expired / not found on the ledger). Useful before a contract upgrade or
 * deployment that references an existing wasm hash.
 *
 * @param server   - Soroban RPC server instance.
 * @param wasmHash - The wasm hash as a hex string or raw bytes.
 * @returns `true` if the entry is archived (not found), `false` if it exists.
 */
export async function checkArchivedContractCode(
  server: ISorobanRpcClient,
  wasmHash: HexString | string | Uint8Array,
): Promise<boolean> {
  const ledgerKey = buildContractCodeKey(wasmHash)
  const archived = await detectArchivedEntries(server, [ledgerKey])
  return archived.length > 0
}

/**
 * Retrieves a contract's wasm (ContractCode) ledger entry.
 * Returns the ledger entry data if it exists, or `null` if archived / not found.
 *
 * @param server   - Soroban RPC server instance.
 * @param wasmHash - The wasm hash as a hex string or raw bytes.
 * @returns The ledger entry if found, otherwise `null`.
 */
export async function getContractCodeEntry(
  server: ISorobanRpcClient,
  wasmHash: HexString | string | Uint8Array,
): Promise<rpc.Api.LedgerEntryResult | null> {
  const ledgerKey = buildContractCodeKey(wasmHash)

  try {
    const result = await server.getLedgerEntries(ledgerKey)
    const entry = result.entries?.[0]
    if (!entry) return null
    // RPC still returns archived entries, with an expired TTL.
    const { liveUntilLedgerSeq } = entry
    const archived = liveUntilLedgerSeq !== undefined && liveUntilLedgerSeq < result.latestLedger
    return archived ? null : entry
  } catch {
    return null
  }
}
