import { describe, expect, it, vi } from 'vitest'
import { createSubscriptionStore } from '../SubscriptionStore.js'

describe('createSubscriptionStore', () => {
  it('provides a typed snapshot and synchronously notifies subscribers on change', () => {
    const store = createSubscriptionStore({ state: 'idle' as const })
    const listener = vi.fn()
    store.subscribe(listener)

    store.setSnapshot({ state: 'success' })

    expect(store.getSnapshot()).toEqual({ state: 'success' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ state: 'success' })
  })

  it('does not notify when the snapshot is unchanged by Object.is', () => {
    const snapshot = { state: 'idle' }
    const store = createSubscriptionStore(snapshot)
    const listener = vi.fn()
    store.subscribe(listener)

    store.setSnapshot(snapshot)

    expect(listener).not.toHaveBeenCalled()
  })

  it('returns an idempotent unsubscribe function', () => {
    const store = createSubscriptionStore(0)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    unsubscribe()
    store.setSnapshot(1)

    expect(listener).not.toHaveBeenCalled()
  })
})
