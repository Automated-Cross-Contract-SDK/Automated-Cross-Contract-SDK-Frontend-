import { NOOP_LOGGER, resolveLogger } from './Logger.js'
import type { Logger } from './types.js'

/** Allows event maps to satisfy index-signature constrained emitter APIs. */
export type WithIndexSignature<T> = T & Record<string, (...args: any[]) => void>;

/**
 * Options accepted by {@link TypedEventEmitter}.
 */
export interface TypedEventEmitterOptions {
  /**
   * Optional logger used to report listener failures and leak warnings.
   * Defaults to {@link NOOP_LOGGER} so nothing is written to the console.
   */
  logger?: Logger
  /**
   * Listener count for a single event above which a leak warning is emitted.
   * Defaults to {@link DEFAULT_MAX_LISTENERS}.
   */
  maxListeners?: number
}

/** Default listener-count threshold before a leak warning is emitted. */
export const DEFAULT_MAX_LISTENERS = 10

type Listener = (...args: any[]) => void

/**
 * A small typed event emitter with injectable logging and listener cleanup.
 *
 * Listener exceptions are routed through the injected {@link Logger} and never
 * prevent other listeners from running. A one-time warning is emitted when the
 * listener count for a single event exceeds the configured threshold.
 */
export class TypedEventEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Listener[]>()
  private readonly warnedEvents = new Set<keyof Events>()
  private readonly logger: Logger
  private readonly maxListeners: number

  constructor(options: TypedEventEmitterOptions = {}) {
    this.logger = resolveLogger(options.logger)
    this.maxListeners = options.maxListeners ?? DEFAULT_MAX_LISTENERS
  }

  on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): () => void {
    const arr = this.listeners.get(event) ?? []
    arr.push(listener as Listener)
    this.listeners.set(event, arr)

    return () => this.off(event, listener)
  }

  off<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): this {
    const arr = this.listeners.get(event)
    if (!arr) return this

    const next = arr.filter((candidate) => candidate !== (listener as Listener))
    if (next.length === 0) {
      this.listeners.delete(event)
    } else {
      this.listeners.set(event, next)
    }
    return this
  }

  once<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): () => void {
    const wrapper = ((...args: any[]) => {
      this.off(event, wrapper as (payload: Events[E]) => void)
      ;(listener as Listener)(...args)
    }) as (payload: Events[E]) => void
    return this.on(event, wrapper)
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): boolean {
    const listeners = this.listeners.get(event)
    if (!listeners || listeners.length === 0) {
      return false
    }

    for (const listener of Array.from(listeners)) {
      try {
        listener(payload)
      } catch (error) {
        console.warn(`SorobanResurrect: event listener error for "${String(event)}":`, error)
      }
    }

    return true
  }

  /**
   * Remove listeners for a single event, or every listener when no event is
   * provided. Also clears the leak-warning state so a re-populated event can
   * warn again.
   */
  removeAllListeners<E extends keyof Events>(event?: E): this {
    if (event === undefined) {
      this.listeners.clear()
      this.warnedEvents.clear()
    } else {
      this.listeners.delete(event)
      this.warnedEvents.delete(event)
    }
    return this
  }

  /** Number of listeners currently registered for the given event. */
  listenerCount<E extends keyof Events>(event: E): number {
    return this.listeners.get(event)?.length ?? 0
  }
}
