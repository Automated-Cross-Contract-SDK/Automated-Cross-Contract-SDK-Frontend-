/**
 * Direct unit tests for TypedEventEmitter (#299).
 *
 * Covers:
 * 1. `on` / `emit` — delivery, ordering, and per-event isolation.
 * 2. `off` and the unsubscribe function returned by `on` / `once`.
 * 3. `once` — single-execution guarantee, including re-entrant emits.
 * 4. Mutation during `emit` (listeners added / removed mid-dispatch).
 * 5. Listener error isolation.
 * 6. Typed payloads per event.
 * 7. Listener leak paths — the emitter has no max-listener cap or leak
 *    warning, so these tests pin that behaviour and verify cleanup instead.
 */

import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest'
import { TypedEventEmitter } from '../EventEmitter.js'

type TestEvents = {
  count: number
  message: { text: string; level: 'info' | 'warn' }
  done: undefined
}

function createEmitter(): TypedEventEmitter<TestEvents> {
  return new TypedEventEmitter<TestEvents>()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TypedEventEmitter — on / emit', () => {
  it('delivers the emitted payload to a registered listener', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.on('count', listener)

    emitter.emit('count', 42)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(42)
  })

  it('delivers the same object reference, without cloning', () => {
    const emitter = createEmitter()
    const payload = { text: 'hello', level: 'info' as const }
    let received: TestEvents['message'] | undefined
    emitter.on('message', (p) => {
      received = p
    })

    emitter.emit('message', payload)

    expect(received).toBe(payload)
  })

  it('calls listeners synchronously in registration order', () => {
    const emitter = createEmitter()
    const order: string[] = []
    emitter.on('count', () => order.push('first'))
    emitter.on('count', () => order.push('second'))
    emitter.on('count', () => order.push('third'))

    emitter.emit('count', 1)
    order.push('after-emit')

    expect(order).toEqual(['first', 'second', 'third', 'after-emit'])
  })

  it('calls a listener on every emit', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.on('count', listener)

    emitter.emit('count', 1)
    emitter.emit('count', 2)
    emitter.emit('count', 3)

    expect(listener.mock.calls).toEqual([[1], [2], [3]])
  })

  it('only notifies listeners of the emitted event', () => {
    const emitter = createEmitter()
    const onCount = vi.fn()
    const onMessage = vi.fn()
    emitter.on('count', onCount)
    emitter.on('message', onMessage)

    emitter.emit('count', 7)

    expect(onCount).toHaveBeenCalledWith(7)
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('is a no-op when emitting an event with no listeners', () => {
    const emitter = createEmitter()
    expect(() => emitter.emit('count', 1)).not.toThrow()
  })

  it('supports events whose payload is undefined', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.on('done', listener)

    emitter.emit('done', undefined)

    expect(listener).toHaveBeenCalledWith(undefined)
  })

  it('calls a listener registered twice once per registration', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.on('count', listener)
    emitter.on('count', listener)

    emitter.emit('count', 1)

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps separate instances fully isolated', () => {
    const a = createEmitter()
    const b = createEmitter()
    const listenerB = vi.fn()
    b.on('count', listenerB)

    a.emit('count', 1)

    expect(listenerB).not.toHaveBeenCalled()
  })
})

describe('TypedEventEmitter — off / unsubscribe', () => {
  it('off() stops a listener from receiving further events', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.on('count', listener)

    emitter.emit('count', 1)
    emitter.off('count', listener)
    emitter.emit('count', 2)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(1)
  })

  it('the function returned by on() removes the listener', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    const unsubscribe = emitter.on('count', listener)

    unsubscribe()
    emitter.emit('count', 1)

    expect(listener).not.toHaveBeenCalled()
  })

  it('only removes the targeted listener', () => {
    const emitter = createEmitter()
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    emitter.on('count', a)
    const unsubscribeB = emitter.on('count', b)
    emitter.on('count', c)

    unsubscribeB()
    emitter.emit('count', 1)

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
    expect(c).toHaveBeenCalledTimes(1)
  })

  it('only removes the listener from the given event', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.on('count', listener)
    emitter.on('done', listener)

    emitter.off('count', listener)
    emitter.emit('count', 1)
    emitter.emit('done', undefined)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(undefined)
  })

  it('removes every registration of the same function in one call', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    const unsubscribe = emitter.on('count', listener)
    emitter.on('count', listener)

    unsubscribe()
    emitter.emit('count', 1)

    expect(listener).not.toHaveBeenCalled()
  })

  it('tolerates calling unsubscribe more than once', () => {
    const emitter = createEmitter()
    const other = vi.fn()
    const unsubscribe = emitter.on('count', vi.fn())
    emitter.on('count', other)

    unsubscribe()
    expect(() => unsubscribe()).not.toThrow()
    emitter.emit('count', 1)

    expect(other).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an event that never had listeners', () => {
    const emitter = createEmitter()
    expect(() => emitter.off('count', vi.fn())).not.toThrow()
  })

  it('is a no-op for a listener that was never registered', () => {
    const emitter = createEmitter()
    const registered = vi.fn()
    emitter.on('count', registered)

    emitter.off('count', vi.fn())
    emitter.emit('count', 1)

    expect(registered).toHaveBeenCalledTimes(1)
  })

  it('allows a listener to be re-registered after removal', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    const unsubscribe = emitter.on('count', listener)
    unsubscribe()

    emitter.on('count', listener)
    emitter.emit('count', 5)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(5)
  })
})

describe('TypedEventEmitter — once', () => {
  it('fires the listener only for the first emit', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.once('count', listener)

    emitter.emit('count', 1)
    emitter.emit('count', 2)
    emitter.emit('count', 3)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(1)
  })

  it('does not fire if unsubscribed before the event', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    const unsubscribe = emitter.once('count', listener)

    unsubscribe()
    emitter.emit('count', 1)

    expect(listener).not.toHaveBeenCalled()
  })

  it('tolerates calling the unsubscribe function after it has fired', () => {
    const emitter = createEmitter()
    const unsubscribe = emitter.once('count', vi.fn())
    emitter.emit('count', 1)

    expect(() => unsubscribe()).not.toThrow()
  })

  it('fires only once even when the listener re-emits the same event', () => {
    const emitter = createEmitter()
    const listener = vi.fn((n: number) => {
      if (n < 5) emitter.emit('count', n + 1)
    })
    emitter.once('count', listener)

    emitter.emit('count', 1)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(1)
  })

  it('removes itself even if the listener throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emitter = createEmitter()
    const listener = vi.fn(() => {
      throw new Error('boom')
    })
    emitter.once('count', listener)

    emitter.emit('count', 1)
    emitter.emit('count', 2)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('runs in registration order alongside on() listeners', () => {
    const emitter = createEmitter()
    const order: string[] = []
    emitter.on('count', () => order.push('on-1'))
    emitter.once('count', () => order.push('once'))
    emitter.on('count', () => order.push('on-2'))

    emitter.emit('count', 1)
    emitter.emit('count', 2)

    expect(order).toEqual(['on-1', 'once', 'on-2', 'on-1', 'on-2'])
  })

  it('treats multiple once() registrations of the same function independently', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.once('count', listener)
    emitter.once('count', listener)

    emitter.emit('count', 1)
    emitter.emit('count', 2)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls).toEqual([[1], [1]])
  })

  // once() registers an internal wrapper, so off() with the original function
  // cannot find it. The returned unsubscribe function is the supported way to
  // cancel a once() listener.
  it('is not removed by off() with the original listener — use the returned unsubscribe', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.once('count', listener)

    emitter.off('count', listener)
    emitter.emit('count', 1)

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('TypedEventEmitter — mutation during emit', () => {
  it('still calls a listener removed by an earlier listener in the same emit', () => {
    const emitter = createEmitter()
    const later = vi.fn()
    emitter.on('count', () => emitter.off('count', later))
    emitter.on('count', later)

    emitter.emit('count', 1)
    emitter.emit('count', 2)

    // Dispatch iterates a snapshot, so the removal takes effect from the next emit.
    expect(later).toHaveBeenCalledTimes(1)
    expect(later).toHaveBeenCalledWith(1)
  })

  it('does not call a listener added during the same emit', () => {
    const emitter = createEmitter()
    const added = vi.fn()
    emitter.once('count', () => {
      emitter.on('count', added)
    })

    emitter.emit('count', 1)
    expect(added).not.toHaveBeenCalled()

    emitter.emit('count', 2)
    expect(added).toHaveBeenCalledTimes(1)
    expect(added).toHaveBeenCalledWith(2)
  })

  it('lets a listener unsubscribe itself without skipping the next listener', () => {
    const emitter = createEmitter()
    const next = vi.fn()
    const unsubscribe = emitter.on('count', () => unsubscribe())
    emitter.on('count', next)

    emitter.emit('count', 1)
    emitter.emit('count', 2)

    expect(next).toHaveBeenCalledTimes(2)
  })
})

describe('TypedEventEmitter — listener errors', () => {
  it('isolates a throwing listener: later listeners still run', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emitter = createEmitter()
    const after = vi.fn()
    emitter.on('count', () => {
      throw new Error('boom')
    })
    emitter.on('count', after)

    expect(() => emitter.emit('count', 1)).not.toThrow()
    expect(after).toHaveBeenCalledWith(1)
  })

  it('logs the error with the event name via console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emitter = createEmitter()
    const failure = new Error('boom')
    emitter.on('message', () => {
      throw failure
    })

    emitter.emit('message', { text: 'hi', level: 'info' })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'SorobanResurrect: event listener error for "message":',
      failure,
    )
  })

  it('keeps a throwing on() listener registered for later emits', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emitter = createEmitter()
    const listener = vi.fn(() => {
      throw new Error('boom')
    })
    emitter.on('count', listener)

    emitter.emit('count', 1)
    emitter.emit('count', 2)

    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('TypedEventEmitter — typed payloads', () => {
  it('infers the listener payload type from the event name', () => {
    const emitter = createEmitter()

    emitter.on('count', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<number>()
    })
    emitter.on('message', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ text: string; level: 'info' | 'warn' }>()
    })
    emitter.once('done', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<undefined>()
    })

    emitter.emit('count', 1)
    emitter.emit('message', { text: 'hi', level: 'warn' })
    emitter.emit('done', undefined)
  })

  it('rejects mismatched payloads and unknown events at compile time', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.on('count', listener)

    // @ts-expect-error — 'count' carries a number, not a string
    emitter.emit('count', 'not-a-number')
    // @ts-expect-error — 'unknown' is not a declared event
    emitter.on('unknown', () => {})
    // @ts-expect-error — the listener expects the 'message' payload shape
    emitter.on('count', (payload: { text: string }) => payload.text)

    // Types are erased at runtime; the payload is passed through untouched.
    expect(listener).toHaveBeenCalledWith('not-a-number')
  })
})

describe('TypedEventEmitter — listener leaks', () => {
  // TypedEventEmitter has no max-listener cap and emits no leak warning
  // (unlike Node's EventEmitter). These tests pin that behaviour and verify
  // that the unsubscribe path is what prevents leaks.
  it('accepts many listeners on one event without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emitter = createEmitter()
    const listeners = Array.from({ length: 100 }, () => vi.fn())
    for (const listener of listeners) emitter.on('count', listener)

    emitter.emit('count', 1)

    expect(warn).not.toHaveBeenCalled()
    for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(1)
  })

  it('releases every listener once all unsubscribe functions are called', () => {
    const emitter = createEmitter()
    const listeners = Array.from({ length: 50 }, () => vi.fn())
    const unsubscribes = listeners.map((listener) => emitter.on('count', listener))

    for (const unsubscribe of unsubscribes) unsubscribe()
    emitter.emit('count', 1)

    for (const listener of listeners) expect(listener).not.toHaveBeenCalled()
  })

  it('does not accumulate once() listeners across repeated subscribe/fire cycles', () => {
    const emitter = createEmitter()
    const listener = vi.fn()

    for (let i = 0; i < 20; i++) {
      emitter.once('count', listener)
      emitter.emit('count', i)
    }
    listener.mockClear()
    emitter.emit('count', 99)

    expect(listener).not.toHaveBeenCalled()
  })
})
