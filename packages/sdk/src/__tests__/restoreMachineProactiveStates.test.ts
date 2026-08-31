/**
 * Tests for the additive proactive / estimation states (#238):
 * `estimating`, `watching_ttl`, and `extending_ttl`.
 *
 * Covers:
 * 1. The FSM reaches every new state from `idle` and flows back to
 *    `success` / `error` / `idle`.
 * 2. `watching_ttl` hands off to `extending_ttl`.
 * 3. `toRestoreStateInfo` maps the new states + messages faithfully.
 * 4. `isProcessingState` keeps its exact result for every pre-existing
 *    state and returns the documented value for the new ones.
 */

import { describe, it, expect } from 'vitest'
import {
  createRestoreService,
  toRestoreStateInfo,
  type RestoreMachineContext,
} from '../RestoreMachine.js'
import { isProcessingState } from '../stateUtils.js'
import type { RestoreState } from '../types.js'

describe('RestoreMachine — proactive / estimation states', () => {
  it('transitions idle → estimating and back to idle on RESET', () => {
    const service = createRestoreService()
    service.send({ type: 'ESTIMATE' })
    expect(service.state.value).toBe('estimating')
    expect(service.state.context.message).toBe('Estimating restore fee and resources...')
    service.send({ type: 'RESET' })
    expect(service.state.value).toBe('idle')
    service.stop()
  })

  it('transitions idle → watching_ttl → extending_ttl → success', () => {
    const service = createRestoreService()
    service.send({ type: 'WATCH_TTL' })
    expect(service.state.value).toBe('watching_ttl')
    service.send({ type: 'EXTEND_TTL' })
    expect(service.state.value).toBe('extending_ttl')
    expect(service.state.context.message).toBe('Extending ledger entry TTL...')
    service.send({ type: 'SUCCESS' })
    expect(service.state.value).toBe('success')
    service.stop()
  })

  it('transitions idle → extending_ttl and to error on FAIL', () => {
    const service = createRestoreService()
    service.send({ type: 'EXTEND_TTL' })
    expect(service.state.value).toBe('extending_ttl')
    service.send({ type: 'FAIL', error: 'bump rejected' })
    expect(service.state.value).toBe('error')
    expect(service.state.context.error).toBe('bump rejected')
    service.stop()
  })

  it('does not allow the new events from mid-submit-flow states', () => {
    const service = createRestoreService()
    service.send({ type: 'SIMULATE' })
    service.send({ type: 'ESTIMATE' }) // ignored — not a valid transition here
    expect(service.state.value).toBe('simulating')
    service.stop()
  })

  it('toRestoreStateInfo maps a new state value + context', () => {
    const ctx: RestoreMachineContext = {
      message: 'Watching ledger entry TTLs...',
      archivedKeys: [],
      error: undefined,
    }
    expect(toRestoreStateInfo('watching_ttl', ctx)).toEqual({
      state: 'watching_ttl',
      message: 'Watching ledger entry TTLs...',
      archivedKeys: [],
      error: undefined,
    })
  })
})

describe('isProcessingState — semantics for pre-existing states unchanged', () => {
  const legacyExpectations: Array<[RestoreState, boolean]> = [
    ['idle', false],
    ['simulating', true],
    ['restore_needed', false],
    ['signing_restore', true],
    ['submitting_restore', true],
    ['confirming_restore', true],
    ['signing_original', true],
    ['submitting_original', true],
    ['success', false],
    ['error', false],
  ]

  it.each(legacyExpectations)('isProcessingState(%s) === %s', (state, expected) => {
    expect(isProcessingState(state)).toBe(expected)
  })

  it('returns true for active proactive states, false for the passive watcher', () => {
    expect(isProcessingState('estimating')).toBe(true)
    expect(isProcessingState('extending_ttl')).toBe(true)
    expect(isProcessingState('watching_ttl')).toBe(false)
  })
})
