/**
 * Transaction history tracking for the SDK.
 *
 * Entry ids are UUID v4 strings when the runtime exposes
 * `crypto.randomUUID()`. On older runtimes a documented fallback is used:
 * `Date.now().toString(36) + '-' + <random base36> + '-' + <counter base36>`,
 * which is unique within a process even across tight insert loops.
 */

export interface TransactionHistoryEntry {
  /**
   * Unique identifier for this history entry.
   *
   * Format: UUID v4 (e.g. `"3b12f1df-5232-4f4a-9c1e-2f0a1b2c3d4e"`) when
   * `crypto.randomUUID()` is available. Otherwise a legacy-compatible
   * fallback string of the form `"<timestamp>-<random>-<counter>"` in
   * base36 is used.
   */
  id: string;
  hash: string;
  status: 'pending' | 'success' | 'failed';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

let fallbackCounter = 0;

/**
 * Generate a unique id for a history entry.
 *
 * Prefers `crypto.randomUUID()` (UUID v4). Falls back to a monotonic
 * timestamp + random + counter string on runtimes without it, so ids stay
 * unique across tight insert loops.
 */
export function generateId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  fallbackCounter = (fallbackCounter + 1) % Number.MAX_SAFE_INTEGER;
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}-${fallbackCounter.toString(36)}`;
}

export class TransactionHistory {
  private entries: TransactionHistoryEntry[] = [];

  add(entry: Omit<TransactionHistoryEntry, 'id'>): TransactionHistoryEntry {
    const full: TransactionHistoryEntry = { id: generateId(), ...entry };
    this.entries.push(full);
    return full;
  }

  getAll(): TransactionHistoryEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  /**
   * Hydrate entries from a previously serialized payload.
   *
   * Entries whose ids were produced by the legacy
   * `Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)`
   * format are preserved as-is; only entries missing an id are assigned a
   * fresh one.
   */
  loadJSON(json: string): TransactionHistoryEntry[] {
    const parsed = JSON.parse(json) as TransactionHistoryEntry[];
    this.entries = parsed.map((entry) => ({
      ...entry,
      id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : generateId(),
    }));
    return this.getAll();
  }

  toJSON(): string {
    return JSON.stringify(this.entries);
  }
}
