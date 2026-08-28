import { rpc, Transaction } from '@stellar/stellar-sdk'
import { xdr } from '@stellar/stellar-sdk'
import { ArchiveDetectionOptions, ArchivedLedgerEntry, SimulateResponse } from './types.js'
import { ARCHIVE_DETECTION_CHUNK_SIZE, ARCHIVE_DETECTION_CONCURRENCY } from './constants.js'
import { createDebugger } from './debug.js'

const debug = createDebugger('archiver')

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
 * Extracts the list of archived ledger keys from a restore simulation response.
 * The read-write entries in the transaction footprint represent the keys that
 * need to be restored.
 *
 * @param response - A restore simulation response, as narrowed by
 *   {@link isRestoreResponse}.
 * @returns Array of {@link ArchivedLedgerEntry}. Empty if the response has
 *   `_parsed: false` or the footprint could not be read (a warning is
 *   logged via `console.warn` in the former case).
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
  const keys: ArchivedLedgerEntry[] = []

  if (!response._parsed) {
    console.warn(
      'SorobanResurrect: restore simulation response has _parsed=false, cannot extract archived keys',
    )
    return keys
  }

  try {
    const footprint = response.transactionData.getFootprint()
    const readWrite = footprint.readWrite()

    for (const ledgerKey of readWrite) {
      const keyBase64 = ledgerKey.toXDR('base64')
      keys.push({
        key: ledgerKey,
        keyBase64,
      })
    }
  } catch (err) {
    debug('extractArchivedKeys: failed to read footprint', err)
    return keys
  }

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
  if (!response._parsed) {
    console.warn(
      'SorobanResurrect: success simulation response has _parsed=false, cannot extract footprint',
    )
    return { readOnly: [], readWrite: [] }
  }

  try {
    const footprint = response.transactionData.getFootprint()
    return {
      readOnly: footprint.readOnly() || [],
      readWrite: footprint.readWrite() || [],
    }
  } catch {
    return { readOnly: [], readWrite: [] }
  }
}

/**
 * Queries the Soroban RPC server to determine which of the given ledger keys
 * correspond to archived (non-existent / expired) entries.
 *
 * Keys are split into chunks (50 per request by default) and the chunk requests
 * are issued in parallel, up to `concurrency` in flight at a time (4 by
 * default), so detection latency on a large footprint does not scale linearly
 * with the number of chunks. If a chunk request fails (network error,
 * rate-limit, etc.), every key in that chunk is conservatively treated as
 * archived to avoid false negatives.
 *
 * @param server - Soroban RPC server instance.
 * @param ledgerKeys - Ledger keys to check (typically the read-write
 *   footprint of a transaction).
 * @param options - Optional {@link ArchiveDetectionOptions} overriding the
 *   chunk size and parallelism. Values below 1 fall back to the defaults.
 * @returns Array of {@link ArchivedLedgerEntry} for keys that are missing
 *   from `getLedgerEntries` results (i.e. archived), or that could not be
 *   verified due to a request error. Ordered to match `ledgerKeys`,
 *   independently of the order in which the chunk requests settled.
 * @see {@link detectArchivedKeysViaDirect}, which wraps this with the
 *   simulate → extract-footprint steps.
 */
export async function detectArchivedEntries(
  server: rpc.Server,
  ledgerKeys: xdr.LedgerKey[],
  options: ArchiveDetectionOptions = {},
): Promise<ArchivedLedgerEntry[]> {
  if (ledgerKeys.length === 0) {
    return []
  }

  const chunkSize =
    options.chunkSize && options.chunkSize >= 1 ? options.chunkSize : ARCHIVE_DETECTION_CHUNK_SIZE
  const concurrency =
    options.concurrency && options.concurrency >= 1
      ? options.concurrency
      : ARCHIVE_DETECTION_CONCURRENCY

  const chunks: xdr.LedgerKey[][] = []
  for (let i = 0; i < ledgerKeys.length; i += chunkSize) {
    chunks.push(ledgerKeys.slice(i, i + chunkSize))
  }

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

  const archived = results.flat()
  debug('detectArchivedEntries: %d of %d key(s) archived', archived.length, ledgerKeys.length)
  return archived
}

/** Resolves a single chunk of keys, treating a failed request as all-archived. */
async function detectArchivedChunk(
  server: rpc.Server,
  chunk: xdr.LedgerKey[],
  chunkIndex: number,
): Promise<ArchivedLedgerEntry[]> {
  const archived: ArchivedLedgerEntry[] = []

  try {
    const result = await server.getLedgerEntries(...chunk)
    // Build a set of returned entry keys to identify archived ones
    const knownKeys = new Set<string>()
    if (result.entries) {
      for (const entry of result.entries) {
        knownKeys.add(entry.key.toXDR('base64'))
      }
    }
    // Check each key in the chunk; if not in returned entries, it's archived
    for (const key of chunk) {
      const keyXdr = key.toXDR('base64')
      if (!knownKeys.has(keyXdr)) {
        archived.push({
          key,
          keyBase64: keyXdr,
        })
      }
    }
  } catch (err) {
    // On network error, conservatively treat all keys in chunk as archived
    debug('detectArchivedEntries: chunk %d failed, assuming archived', chunkIndex, err)
    return chunk.map((key) => ({
      key,
      keyBase64: key.toXDR('base64'),
    }))
  }

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
  server: rpc.Server,
  transaction: Transaction,
): Promise<ArchivedLedgerEntry[]> {
  const response = await server.simulateTransaction(transaction)

  if (isRestoreResponse(response)) {
    return extractArchivedKeys(response)
  }

  return []
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
 * @param options - Optional {@link ArchiveDetectionOptions} forwarded to
 *   {@link detectArchivedEntries} to tune chunk size and parallelism.
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
  server: rpc.Server,
  transaction: Transaction,
  options: ArchiveDetectionOptions = {},
): Promise<ArchivedLedgerEntry[]> {
  const response = await server.simulateTransaction(transaction)

  if (isErrorResponse(response)) {
    throw new Error(`Simulation error: ${response.error}`)
  }

  if (isRestoreResponse(response)) {
    throw new Error('Archived entries already detected via simulation restore response')
  }

  if (!isSuccessResponse(response)) {
    throw new Error('Unexpected simulation response type')
  }

  const { readWrite } = extractFootprintFromSuccess(response)

  if (readWrite.length === 0) {
    return []
  }

  return detectArchivedEntries(server, readWrite, options)
}

/**
 * Builds a ContractData ledger key for a given contract ID and storage key.
 * This is used to query specific contract data entries on the ledger.
 *
 * @param contractId - The Stellar contract ID string (e.g. "CCJZ5...").
 * @param key - The storage key as an xdr.ScVal.
 * @param keyType - The durability of the storage entry (persistent or temporary).
 * @returns An xdr.LedgerKey for the ContractData entry.
 */
export function buildContractDataKey(
  contractId: string,
  key: xdr.ScVal,
  keyType: 'persistent' | 'temporary' = 'persistent',
): xdr.LedgerKey {
  // Convert hex contract ID string to bytes
  const contractBytes = new Uint8Array(
    (contractId.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)),
  )

  const contractAddress = {
    switch: () => xdr.ScAddressType.scAddressTypeContract(),
    contractId: contractBytes,
  } as unknown as xdr.ScAddress

  const contractData = {
    contract: contractAddress,
    key,
    durability:
      keyType === 'temporary'
        ? xdr.ContractDataDurability.temporary()
        : xdr.ContractDataDurability.persistent(),
  } as unknown as xdr.LedgerKeyContractData

  return {
    type: xdr.LedgerEntryType.contractData(),
    contractData,
  } as unknown as xdr.LedgerKey
}

/**
 * Checks whether a specific contract data entry is archived (expired / not found
 * on the ledger). This is a targeted utility for dApp developers who want to
 * check specific storage slots without simulating a full transaction.
 *
 * @param server - Soroban RPC server instance.
 * @param contractId - The Stellar contract ID string.
 * @param key - The storage key as an xdr.ScVal.
 * @param keyType - The durability of the storage entry (persistent or temporary).
 * @returns `true` if the entry is archived (not found), `false` if it exists.
 *
 * @example
 * ```ts
 * import { xdr } from '@stellar/stellar-sdk'
 * const isArchived = await checkArchivedContractData(
 *   server,
 *   'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q',
 *   xdr.ScVal.scvSymbol('Balance'),
 *   'persistent',
 * )
 * ```
 */
export async function checkArchivedContractData(
  server: rpc.Server,
  contractId: string,
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
 * @param contractId - The Stellar contract ID string.
 * @param key - The storage key as an xdr.ScVal.
 * @param keyType - The durability of the storage entry (persistent or temporary).
 * @returns The ledger entry if found, otherwise `null`.
 *
 * @example
 * ```ts
 * import { xdr } from '@stellar/stellar-sdk'
 * const entry = await getContractDataEntry(
 *   server,
 *   'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q',
 *   xdr.ScVal.scvSymbol('Balance'),
 * )
 * if (entry) {
 *   console.log('Entry exists:', entry.key.toXDR('base64'))
 * }
 * ```
 */
export async function getContractDataEntry(
  server: rpc.Server,
  contractId: string,
  key: xdr.ScVal,
  keyType: 'persistent' | 'temporary' = 'persistent',
): Promise<rpc.Api.LedgerEntryResult | null> {
  const ledgerKey = buildContractDataKey(contractId, key, keyType)

  try {
    const result = await server.getLedgerEntries(ledgerKey)
    if (result.entries && result.entries.length > 0) {
      return result.entries[0]
    }
    return null
  } catch {
    return null
  }
}
