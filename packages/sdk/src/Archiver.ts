import { xdr } from '@stellar/stellar-sdk'
import { rpc } from '@stellar/stellar-sdk'
import { ArchivedLedgerEntry, SimulateResponse } from './types.js'

/**
 * Type guard — returns true if the simulation response indicates archived
 * ledger entries that need restoration.
 */
export function isRestoreResponse(
  response: SimulateResponse,
): response is rpc.Api.SimulateTransactionRestoreResponse {
  return rpc.Api.isSimulationRestore(response)
}

/**
 * Type guard — returns true if the simulation response indicates a
 * successful simulation with no restore required.
 */
export function isSuccessResponse(
  response: SimulateResponse,
): response is rpc.Api.SimulateTransactionSuccessResponse {
  return rpc.Api.isSimulationSuccess(response)
}

/**
 * Type guard — returns true if the simulation response indicates an error.
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
  } catch {
    return keys
  }

  return keys
}

/**
 * Extracts the read-only and read-write ledger keys from a success simulation
 * response footprint.
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
 * Keys are fetched in chunks of 50. If a chunk request fails (network error,
 * rate-limit, etc.), every key in that chunk is conservatively treated as
 * archived to avoid false negatives.
 */
export async function detectArchivedEntries(
  server: rpc.Server,
  ledgerKeys: xdr.LedgerKey[],
): Promise<ArchivedLedgerEntry[]> {
  const archived: ArchivedLedgerEntry[] = []

  const chunkSize = 50
  for (let i = 0; i < ledgerKeys.length; i += chunkSize) {
    const chunk = ledgerKeys.slice(i, i + chunkSize)
    try {
      const result = await server.getLedgerEntries(...chunk)
      const knownKeys = new Set(
        (result.entries ?? []).map((e) => e.key.toXDR('base64')),
      )
      for (const key of chunk) {
        if (!knownKeys.has(key.toXDR('base64'))) {
          archived.push({
            key,
            keyBase64: key.toXDR('base64'),
          })
        }
      }
    } catch {
      archived.push(
        ...chunk.map((key) => ({
          key,
          keyBase64: key.toXDR('base64'),
        })),
      )
    }
  }

  return archived
}
