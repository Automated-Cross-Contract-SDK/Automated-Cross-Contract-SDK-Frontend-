/**
 * Direct unit tests for SorobanResurrectStateManager (#298).
 *
 * Covers:
 * 1. Initial state and the `stateInfo` snapshot shape.
 * 2. Transitions — `setState` side-effects (error / archived-key clearing)
 *    and the documented policy that the manager does not enforce a
 *    transition graph (sequencing is the executor's responsibility).
 * 3. `setError` / `setArchivedKeys`.
 * 4. `reset()` with and without the `fromState` guard, including idempotency.
 * 5. Listener subscription, notification order, error isolation, and
 *    unsubscription.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { SorobanResurrectStateManager } from '../SorobanResurrectState.js'
import type { ArchivedLedgerEntry, RestoreState, RestoreStateInfo } from '../types.js'

/** Minimal stand-in for an archived entry — the manager never inspects it. */
function fakeEntry(keyBase64: string): ArchivedLedgerEntry {
  return { keyBase64 } as unknown as ArchivedLedgerEntry
}

/** The snapshot of a freshly constructed or reset manager. */
const IDLE_SNAPSHOT: RestoreStateInfo = {
  state: 'idle',
  message: '',
  archivedKeys: [],
  error: undefined,
}

const ALL_STATES: RestoreState[] = [
  'idle',
  'simulating',
  'restore_needed',
  'signing_restore',
  'submitting_restore',
  'confirming_restore',
  'signing_original',
  'submitting_original',
  'success',
  'error',
  'estimating',
  'watching_ttl',
  'extending_ttl',
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SorobanResurrectStateManager — initial state', () => {
  it('starts idle with an empty message, no error, and no archived keys', () => {
    const sm = new SorobanResurrectStateManager()
    expect(sm.state).toBe('idle')
    expect(sm.lastError).toBeUndefined()
    expect(sm.lastArchivedKeys).toEqual([])
    expect(sm.stateInfo).toEqual(IDLE_SNAPSHOT)
  })
})

describe('SorobanResurrectStateManager — stateInfo snapshots', () => {
  it('reflects the current state, message, archived keys, and error', () => {
    const sm = new SorobanResurrectStateManager()
    const keys = [fakeEntry('AAAA')]
    sm.setState('simulating', 'Simulating transaction...')
    sm.setArchivedKeys(keys)
    sm.setState('restore_needed', 'Restore required')

    expect(sm.stateInfo).toEqual({
      state: 'restore_needed',
      message: 'Restore required',
      archivedKeys: keys,
      error: undefined,
    })
  })

  it('returns a new object on every access', () => {
    const sm = new SorobanResurrectStateManager()
    expect(sm.stateInfo).not.toBe(sm.stateInfo)
  })

  it('is a point-in-time snapshot unaffected by later transitions', () => {
    const sm = new SorobanResurrectStateManager()
    sm.setArchivedKeys([fakeEntry('AAAA')])
    sm.setState('restore_needed', 'Restore required')
    const snapshot = sm.stateInfo

    sm.setError('boom')

    expect(snapshot.state).toBe('restore_needed')
    expect(snapshot.message).toBe('Restore required')
    expect(snapshot.error).toBeUndefined()
    expect(snapshot.archivedKeys).toHaveLength(1)
  })
})

describe('SorobanResurrectStateManager — transitions', () => {
  it('follows the happy-path sequence of the restore workflow', () => {
    const sm = new SorobanResurrectStateManager()
    const seen: RestoreState[] = []
    sm.onStateChange((info) => seen.push(info.state))

    const happyPath: RestoreState[] = [
      'simulating',
      'restore_needed',
      'signing_restore',
      'submitting_restore',
      'confirming_restore',
      'signing_original',
      'submitting_original',
      'success',
    ]
    for (const state of happyPath) sm.setState(state, state)

    expect(seen).toEqual(happyPath)
    expect(sm.state).toBe('success')
  })

  // The manager is a passive store: it does not validate transitions against
  // the ARCHITECTURE.md diagram. Out-of-order transitions are accepted and
  // documented as allowed; the executor is responsible for sequencing.
  it.each(ALL_STATES.flatMap((from) => ALL_STATES.map((to) => [from, to] as const)))(
    'accepts %s → %s without throwing (no transition graph is enforced)',
    (from, to) => {
      const sm = new SorobanResurrectStateManager()
      sm.setState(from, 'from')
      expect(() => sm.setState(to, 'to')).not.toThrow()
      expect(sm.state).toBe(to)
      expect(sm.stateInfo.message).toBe('to')
    },
  )

  it('clears lastError when moving to any non-error state', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'error')) {
      const sm = new SorobanResurrectStateManager()
      sm.setError('boom')
      sm.setState(state, 'next')
      expect(sm.lastError, state).toBeUndefined()
    }
  })

  it.each(['idle', 'simulating'] as const)('clears archived keys when entering %s', (state) => {
    const sm = new SorobanResurrectStateManager()
    sm.setArchivedKeys([fakeEntry('AAAA')])
    sm.setState(state, '')
    expect(sm.lastArchivedKeys).toEqual([])
  })

  it('keeps archived keys through the restore and submit states', () => {
    const sm = new SorobanResurrectStateManager()
    const keys = [fakeEntry('AAAA'), fakeEntry('BBBB')]
    sm.setArchivedKeys(keys)
    for (const state of ALL_STATES.filter((s) => s !== 'idle' && s !== 'simulating')) {
      sm.setState(state, state)
      expect(sm.lastArchivedKeys, state).toBe(keys)
    }
  })
})

describe('SorobanResurrectStateManager — setError / setArchivedKeys', () => {
  it('setError transitions to error and uses the error as the message by default', () => {
    const sm = new SorobanResurrectStateManager()
    sm.setError('Simulation failed')
    expect(sm.state).toBe('error')
    expect(sm.lastError).toBe('Simulation failed')
    expect(sm.stateInfo).toMatchObject({
      state: 'error',
      message: 'Simulation failed',
      error: 'Simulation failed',
    })
  })

  it('setError accepts a separate human-readable message', () => {
    const sm = new SorobanResurrectStateManager()
    sm.setError('tx_bad_seq', 'Transaction failed, please retry')
    expect(sm.lastError).toBe('tx_bad_seq')
    expect(sm.stateInfo.message).toBe('Transaction failed, please retry')
  })

  it('setError preserves archived keys detected earlier in the workflow', () => {
    const sm = new SorobanResurrectStateManager()
    const keys = [fakeEntry('AAAA')]
    sm.setArchivedKeys(keys)
    sm.setError('boom')
    expect(sm.stateInfo.archivedKeys).toBe(keys)
  })

  it('setArchivedKeys updates the cache without notifying listeners', () => {
    const sm = new SorobanResurrectStateManager()
    const listener = vi.fn()
    sm.onStateChange(listener)
    sm.setArchivedKeys([fakeEntry('AAAA')])
    expect(listener).not.toHaveBeenCalled()
    expect(sm.lastArchivedKeys).toHaveLength(1)
  })
})

describe('SorobanResurrectStateManager — reset()', () => {
  it('without fromState, resets from any state back to a clean idle', () => {
    for (const state of ALL_STATES) {
      const sm = new SorobanResurrectStateManager()
      sm.setArchivedKeys([fakeEntry('AAAA')])
      if (state === 'error') sm.setError('boom')
      else sm.setState(state, 'busy')

      sm.reset()

      expect(sm.stateInfo, state).toEqual(IDLE_SNAPSHOT)
    }
  })

  it('notifies listeners with the idle snapshot', () => {
    const sm = new SorobanResurrectStateManager()
    sm.setError('boom')
    const listener = vi.fn()
    sm.onStateChange(listener)

    sm.reset()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(IDLE_SNAPSHOT)
  })

  it('with a matching fromState, resets to idle', () => {
    const sm = new SorobanResurrectStateManager()
    sm.setError('boom')
    sm.reset('error')
    expect(sm.state).toBe('idle')
    expect(sm.lastError).toBeUndefined()
  })

  it('with a non-matching fromState, is a no-op and does not notify', () => {
    const sm = new SorobanResurrectStateManager()
    const keys = [fakeEntry('AAAA')]
    sm.setArchivedKeys(keys)
    sm.setState('signing_restore', 'Waiting for signature')
    const listener = vi.fn()
    const eventListener = vi.fn()
    sm.onStateChange(listener)
    sm.emitter.on('stateChange', eventListener)

    sm.reset('error')

    expect(sm.stateInfo).toEqual({
      state: 'signing_restore',
      message: 'Waiting for signature',
      archivedKeys: keys,
      error: undefined,
    })
    expect(listener).not.toHaveBeenCalled()
    expect(eventListener).not.toHaveBeenCalled()
  })

  it('guards concurrent resets: only the first reset(fromState) takes effect', () => {
    const sm = new SorobanResurrectStateManager()
    sm.setState('success', 'Done')
    const listener = vi.fn()
    sm.onStateChange(listener)

    sm.reset('success')
    sm.reset('success')

    expect(sm.state).toBe('idle')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('is idempotent in outcome when called repeatedly without fromState', () => {
    const sm = new SorobanResurrectStateManager()
    const listener = vi.fn()
    sm.onStateChange(listener)

    sm.reset()
    sm.reset()

    expect(sm.stateInfo).toEqual(IDLE_SNAPSHOT)
    // An unguarded reset always re-publishes the idle state.
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('SorobanResurrectStateManager — listeners', () => {
  it('calls every listener synchronously with the new snapshot', () => {
    const sm = new SorobanResurrectStateManager()
    const received: RestoreStateInfo[] = []
    sm.onStateChange((info) => received.push(info))

    sm.setState('simulating', 'Simulating transaction...')

    expect(received).toEqual([
      {
        state: 'simulating',
        message: 'Simulating transaction...',
        archivedKeys: [],
        error: undefined,
      },
    ])
  })

  it('notifies listeners in registration order, before the stateChange typed event', () => {
    const sm = new SorobanResurrectStateManager()
    const order: string[] = []
    sm.emitter.on('stateChange', () => order.push('event'))
    sm.onStateChange(() => order.push('listener-1'))
    sm.onStateChange(() => order.push('listener-2'))
    sm.onStateChange(() => order.push('listener-3'))

    sm.setState('simulating', '')

    expect(order).toEqual(['listener-1', 'listener-2', 'listener-3', 'event'])
  })

  it('emits the stateChange typed event with the same snapshot', () => {
    const sm = new SorobanResurrectStateManager()
    const fromListener = vi.fn()
    const fromEvent = vi.fn()
    sm.onStateChange(fromListener)
    sm.emitter.on('stateChange', fromEvent)

    sm.setError('boom', 'Something went wrong')

    const expected = {
      state: 'error',
      message: 'Something went wrong',
      archivedKeys: [],
      error: 'boom',
    }
    expect(fromListener).toHaveBeenCalledWith(expected)
    expect(fromEvent).toHaveBeenCalledWith(expected)
  })

  it('stops notifying a listener after it unsubscribes', () => {
    const sm = new SorobanResurrectStateManager()
    const listener = vi.fn()
    const unsubscribe = sm.onStateChange(listener)

    sm.setState('simulating', '')
    unsubscribe()
    sm.setState('success', '')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('only removes the unsubscribed listener', () => {
    const sm = new SorobanResurrectStateManager()
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribeA = sm.onStateChange(a)
    sm.onStateChange(b)

    unsubscribeA()
    sm.setState('simulating', '')

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('tolerates calling unsubscribe more than once', () => {
    const sm = new SorobanResurrectStateManager()
    const other = vi.fn()
    const unsubscribe = sm.onStateChange(vi.fn())
    sm.onStateChange(other)

    unsubscribe()
    expect(() => unsubscribe()).not.toThrow()
    sm.setState('simulating', '')

    expect(other).toHaveBeenCalledTimes(1)
  })

  it('isolates a throwing listener: others still run and the error is logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sm = new SorobanResurrectStateManager()
    const failure = new Error('listener failed')
    const after = vi.fn()
    const eventListener = vi.fn()
    sm.onStateChange(() => {
      throw failure
    })
    sm.onStateChange(after)
    sm.emitter.on('stateChange', eventListener)

    expect(() => sm.setState('simulating', '')).not.toThrow()

    expect(after).toHaveBeenCalledTimes(1)
    expect(eventListener).toHaveBeenCalledTimes(1)
    expect(sm.state).toBe('simulating')
    expect(warn).toHaveBeenCalledWith('SorobanResurrect: state listener error:', failure)
  })

  it('keeps separate instances fully isolated', () => {
    const a = new SorobanResurrectStateManager()
    const b = new SorobanResurrectStateManager()
    const listenerB = vi.fn()
    b.onStateChange(listenerB)

    a.setError('boom')

    expect(b.state).toBe('idle')
    expect(listenerB).not.toHaveBeenCalled()
  })
})
