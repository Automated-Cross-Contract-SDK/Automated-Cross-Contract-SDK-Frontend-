/** Map of event name to the payload type emitted for that event. */
export type EventMap = Record<string, unknown>

type Listener<T> = (payload: T) => void

/**
 * Minimal typed event emitter. Listeners registered for an event only ever
 * receive the payload type declared for that event in the `Events` map.
 */
export class TypedEventEmitter<Events extends EventMap> {
  private listeners: { [K in keyof Events]?: Array<Listener<Events[K]>> } = {}

  /** Registers a listener for `event`. Returns a function that removes it. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const list = this.listeners[event] ?? (this.listeners[event] = [])
    list.push(listener)
    return () => this.off(event, listener)
  }

  /** Registers a listener that fires at most once for `event`. */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const wrapped: Listener<Events[K]> = (payload) => {
      this.off(event, wrapped)
      listener(payload)
    }
    return this.on(event, wrapped)
  }

  /** Removes a previously registered listener for `event`. */
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    const list = this.listeners[event]
    if (!list) return
    this.listeners[event] = list.filter((l) => l !== listener)
  }

  /** Invokes every listener registered for `event` with `payload`. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.listeners[event]
    if (!list) return
    for (const listener of [...list]) {
      try {
        listener(payload)
      } catch (err) {
        console.warn(`SorobanResurrect: event listener error for "${String(event)}":`, err)
      }
    }
  }
}
