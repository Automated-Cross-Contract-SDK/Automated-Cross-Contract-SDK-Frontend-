import { Logger, NOOP_LOGGER, resolveLogger } from './logger';

/**
 * Options accepted by {@link TypedEventEmitter}.
 */
export interface TypedEventEmitterOptions {
  /**
   * Optional logger used to report listener failures and leak warnings.
   * Defaults to {@link NOOP_LOGGER} so nothing is written to the console.
   */
  logger?: Logger;
  /**
   * Listener count for a single event above which a leak warning is emitted.
   * Defaults to {@link DEFAULT_MAX_LISTENERS}.
   */
  maxListeners?: number;
}

/** Default listener-count threshold before a leak warning is emitted. */
export const DEFAULT_MAX_LISTENERS = 10;

type Listener = (...args: any[]) => void;

/**
 * A small typed event emitter with injectable logging and listener cleanup.
 *
 * Listener exceptions are routed through the injected {@link Logger} and never
 * prevent other listeners from running. A one-time warning is emitted when the
 * listener count for a single event exceeds the configured threshold.
 */
export class TypedEventEmitter<Events extends Record<string, (...args: any[]) => void>> {
  private readonly listeners = new Map<keyof Events, Set<Listener>>();
  private readonly warnedEvents = new Set<keyof Events>();
  private readonly logger: Logger;
  private readonly maxListeners: number;

  constructor(options: TypedEventEmitterOptions = {}) {
    this.logger = resolveLogger(options.logger);
    this.maxListeners = options.maxListeners ?? DEFAULT_MAX_LISTENERS;
  }

  on<E extends keyof Events>(event: E, listener: Events[E]): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set<Listener>();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener);

    if (set.size > this.maxListeners && !this.warnedEvents.has(event)) {
      this.warnedEvents.add(event);
      this.logger.warn(
        `Possible event listener leak detected: ${String(event)} has ${set.size} listeners ` +
          `(threshold ${this.maxListeners}).`,
      );
    }

    return this;
  }

  off<E extends keyof Events>(event: E, listener: Events[E]): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener as Listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  once<E extends keyof Events>(event: E, listener: Events[E]): this {
    const wrapper = ((...args: any[]) => {
      this.off(event, wrapper as Events[E]);
      (listener as Listener)(...args);
    }) as Events[E];
    return this.on(event, wrapper);
  }

  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) {
      return false;
    }

    for (const listener of Array.from(set)) {
      try {
        listener(...args);
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
   * Remove listeners for a single event, or every listener when no event is
   * provided. Also clears the leak-warning state so a re-populated event can
   * warn again.
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
