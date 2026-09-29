import type { rpc, xdr } from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from './RpcClient.js'
import { LEDGER_ENTRY_CHUNK_SIZE, LEDGER_ENTRY_CONCURRENCY } from './constants.js'

/** Options for {@link fetchLedgerEntriesChunked}. */
export interface ChunkedFetchOptions {
  /** Keys per `getLedgerEntries` request (default {@link LEDGER_ENTRY_CHUNK_SIZE}). */
  chunkSize?: number
  /** Maximum chunk requests in flight (default {@link LEDGER_ENTRY_CONCURRENCY}). */
  concurrency?: number
  /** Called when a chunk request fails; the chunk's entries are omitted. */
  onChunkError?: (err: unknown, chunkIndex: number, keys: xdr.LedgerKey[]) => void
}

/**
 * Fetches ledger entries in chunks with bounded concurrency. This is the single
 * chunking implementation shared by the TTL and scan read paths.
 *
 * @returns Entries found on-chain, grouped in input chunk order.
 */
export async function fetchLedgerEntriesChunked(
  server: ISorobanRpcClient,
  keys: xdr.LedgerKey[],
  opts: ChunkedFetchOptions = {},
): Promise<rpc.Api.LedgerEntryResult[]> {
  const chunkSize = Math.max(1, opts.chunkSize ?? LEDGER_ENTRY_CHUNK_SIZE)
  const concurrency = Math.max(1, opts.concurrency ?? LEDGER_ENTRY_CONCURRENCY)

  const chunks: xdr.LedgerKey[][] = []
  for (let i = 0; i < keys.length; i += chunkSize) chunks.push(keys.slice(i, i + chunkSize))

  const results: rpc.Api.LedgerEntryResult[][] = new Array(chunks.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < chunks.length) {
      const index = next++
      try {
        const res = await server.getLedgerEntries(...chunks[index])
        results[index] = res.entries ?? []
      } catch (err) {
        results[index] = []
        opts.onChunkError?.(err, index, chunks[index])
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))
  return results.flat()
}
