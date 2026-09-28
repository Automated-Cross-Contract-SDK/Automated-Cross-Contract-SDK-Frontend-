import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { logger } from './logger';
import type { TTLQueryResult, TTLQueryEntry, TTLQueryError } from './types';

/**
 * Minimal shape of the resilient RPC client used by the SDK.
 * Kept structural so tests can inject a fake without pulling in the
 * concrete implementation.
 */
export interface ResilientRpcClient {
  getLedgerEntries(
    keys: xdr.LedgerKey[],
  ): Promise<SorobanRpc.Api.GetLedgerEntriesResponse>;
}

export interface QueryLedgerTTLOptions {
  /** Maximum number of ledger keys to request per RPC call. */
  chunkSize?: number;
  /** Injectable logger; defaults to the SDK logger. */
  logger?: Pick<typeof logger, 'warn' | 'error'>;
}

const DEFAULT_CHUNK_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Query the TTL of a set of ledger keys.
 *
 * Entries are pre-populated as `unknown` rather than `archived`. Only an
 * explicit absence in a successful RPC response marks an entry as archived,
 * so a transient RPC failure can never be mistaken for an expiring entry.
 */
export async function queryLedgerTTL(
  client: ResilientRpcClient,
  keys: xdr.LedgerKey[],
  options: QueryLedgerTTLOptions = {},
): Promise<TTLQueryResult> {
  const { chunkSize = DEFAULT_CHUNK_SIZE } = options;
  const log = options.logger ?? logger;

  const entries = new Map<string, TTLQueryEntry>();
  for (const key of keys) {
    entries.set(key.toXDR('base64'), {
      key,
      status: 'unknown',
      isArchived: false,
    });
  }

  const failedChunks: TTLQueryError[] = [];
  const chunks = chunk(keys, chunkSize);

  for (let index = 0; index < chunks.length; index++) {
    const chunkKeys = chunks[index];
    try {
      const response = await client.getLedgerEntries(chunkKeys);
      const found = new Set<string>();
      for (const entry of response.entries ?? []) {
        const id = entry.key.toXDR('base64');
        found.add(id);
        const existing = entries.get(id);
        if (existing) {
          existing.status = 'live';
          existing.isArchived = false;
          existing.liveUntilLedgerSeq = entry.liveUntilLedgerSeq;
          existing.lastModifiedLedgerSeq = entry.lastModifiedLedgerSeq;
        }
      }
      // Only keys absent from a *successful* response are archived.
      for (const key of chunkKeys) {
        const id = key.toXDR('base64');
        if (!found.has(id)) {
          const existing = entries.get(id);
          if (existing) {
            existing.status = 'archived';
            existing.isArchived = true;
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedChunks.push({ chunkIndex: index, message });
      log.warn(
        `queryLedgerTTL: chunk ${index} failed, leaving ${chunkKeys.length} entries as unknown`,
        { error },
      );
      // Entries in this chunk keep status 'unknown' / isArchived: false.
    }
  }

  return {
    entries: Array.from(entries.values()),
    failedChunks,
    errors: failedChunks,
  };
}

/**
 * Return entries that are known to be archived and expiring soon.
 * Unknown-status entries (failed chunks) are excluded so a transient RPC
 * failure never triggers a needless restore transaction.
 */
export function getExpiringSoonEntries(
  result: TTLQueryResult,
  thresholdLedgers: number,
  currentLedger: number,
): TTLQueryEntry[] {
  return result.entries.filter((entry) => {
    if (entry.status !== 'live') return false;
    if (entry.liveUntilLedgerSeq === undefined) return false;
    return entry.liveUntilLedgerSeq - currentLedger <= thresholdLedgers;
  });
}
