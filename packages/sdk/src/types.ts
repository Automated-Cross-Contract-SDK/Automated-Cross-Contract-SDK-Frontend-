/**
 * Minimal logger interface used across the SDK.
 *
 * Consumers can inject their own implementation via `config.logger`.
 * When no logger is provided the SDK falls back to {@link NOOP_LOGGER}.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * A logger that discards every message. Used as the default when no
 * logger is injected so the SDK never writes to the console on its own.
 */
export const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Resolve the logger to use for a given configuration, falling back to
 * {@link NOOP_LOGGER} when none was provided.
 */
export function resolveLogger(config?: { logger?: Logger }): Logger {
  return config?.logger ?? NOOP_LOGGER;
}

/**
 * Options accepted by {@link TypedEventEmitter}.
 */
export interface EventEmitterOptions {
  /** Optional logger used to report listener failures and leak warnings. */
  logger?: Logger;
  /**
   * Maximum number of listeners allowed for a single event before a leak
   * warning is emitted. Defaults to {@link DEFAULT_MAX_LISTENERS}.
   */
  maxListeners?: number;
}

/** Default listener threshold before a leak warning is emitted. */
export const DEFAULT_MAX_LISTENERS = 10;

/**
 * A typed event map: event name to the listener signature for that event.
 */
export type EventMap = Record<string, (...args: any[]) => void>;

/**
 * A strongly typed event emitter with injectable logging and listener
 * cleanup helpers.
 */
export class TypedEventEmitter<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<(...args: any[]) => void>>();
  private readonly warnedEvents = new Set<keyof Events>();
  private readonly logger: Logger;
  private readonly maxListeners: number;

  constructor(options: EventEmitterOptions = {}) {
    this.logger = options.logger ?? NOOP_LOGGER;
    this.maxListeners = options.maxListeners ?? DEFAULT_MAX_LISTENERS;
  }

  on<E extends keyof Events>(event: E, listener: Events[E]): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);

    if (set.size > this.maxListeners && !this.warnedEvents.has(event)) {
      this.warnedEvents.add(event);
      this.logger.warn(
        `Possible event listener leak detected: "${String(event)}" has ${set.size} listeners ` +
          `(max ${this.maxListeners}).`,
      );
    }

    return this;
  }

  off<E extends keyof Events>(event: E, listener: Events[E]): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  once<E extends keyof Events>(event: E, listener: Events[E]): this {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper as Events[E]);
      (listener as (...args: any[]) => void)(...args);
    };
    return this.on(event, wrapper as Events[E]);
  }

  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      return false;
    }

    for (const listener of Array.from(set)) {
      try {
        (listener as (...args: any[]) => void)(...args);
      } catch (error) {
        this.logger.error(
          `Error in listener for event "${String(event)}":`,
          error,
        );
      }
    }

    return true;
  }

  /**
   * Remove listeners. When `event` is provided only that event's listeners
   * are removed; otherwise every listener for every event is cleared.
   */
  removeAllListeners<E extends keyof Events>(event?: E): this {
    if (event === undefined) {
      this.listeners.clear();
      this.warnedEvents.clear();
    } else {
      this.listeners.delete(event);
      this.warnedEvents.delete(event);
    }
    return this;
  }

  /** Number of listeners currently registered for the given event. */
  listenerCount<E extends keyof Events>(event: E): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/**
 * Status of a single ledger entry as reported by {@link queryLedgerTTL}.
 *
 * - `live`: the RPC confirmed the entry exists and is not archived.
 * - `archived`: the RPC confirmed the entry is absent/archived.
 * - `unknown`: the request for this entry failed, so its status could not
 *   be determined. Unknown entries must never be treated as archived.
 */
export type TTLQueryStatus = 'live' | 'archived' | 'unknown';

/**
 * A single entry returned by {@link queryLedgerTTL}.
 */
export interface TTLQueryEntry {
  /** The ledger key this entry describes. */
  key: string;
  /** Whether the entry is live, archived, or of unknown status. */
  status: TTLQueryStatus;
  /**
   * Convenience flag mirroring `status === 'archived'`. Entries whose status
   * is `unknown` are never reported as archived.
   */
  isArchived: boolean;
  /** Remaining TTL in ledgers, when known. */
  ttl?: number;
}

/**
 * Describes a chunk of keys whose `getLedgerEntries` request failed.
 */
export interface TTLQueryChunkError {
  /** Index of the failing chunk within the original request. */
  chunkIndex: number;
  /** The keys that were part of the failing chunk. */
  keys: string[];
  /** The error thrown by the underlying RPC call. */
  error: unknown;
}

/**
 * Result of {@link queryLedgerTTL}.
 *
 * `failedChunks` exposes which chunks failed and why so callers can
 * distinguish a confirmed-absent entry from one whose status is unknown.
 */
export interface TTLQueryResult {
  /** Per-key status, keyed by the requested ledger key. */
  entries: Record<string, TTLQueryEntry>;
  /** Chunks whose request failed, with the underlying error. */
  failedChunks: TTLQueryChunkError[];
  /** Convenience flag: true when at least one chunk failed. */
  hasErrors: boolean;
}
