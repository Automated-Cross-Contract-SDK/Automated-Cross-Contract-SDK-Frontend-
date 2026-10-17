/** Listener notified when a subscription store publishes a new snapshot. */
export type SubscriptionListener<T> = (snapshot: T) => void

/** Framework-independent interface for reading and subscribing to a snapshot. */
export interface SubscriptionStore<T> {
  /** Read the current snapshot. */
  getSnapshot(): T
  /** Subscribe to snapshot changes and receive an unsubscribe function. */
  subscribe(listener: SubscriptionListener<T>): () => void
  /** Publish a snapshot and notify listeners when it changes by `Object.is`. */
  setSnapshot(snapshot: T): void
}

/**
 * Create a minimal typed external store with no framework dependency.
 *
 * Subscribers are notified synchronously only when the snapshot changes by
 * `Object.is`. The returned unsubscribe function is safe to call repeatedly.
 */
export function createSubscriptionStore<T>(initialSnapshot: T): SubscriptionStore<T> {
  let snapshot = initialSnapshot
  const listeners = new Set<SubscriptionListener<T>>()

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setSnapshot: (nextSnapshot) => {
      if (Object.is(snapshot, nextSnapshot)) return
      snapshot = nextSnapshot
      for (const listener of [...listeners]) listener(snapshot)
    },
  }
}
