import { describe, expect, it } from 'vitest'
import { createRestoreService, type RestoreMachineEvent } from '../RestoreMachine.js'
import type { RestoreState } from '../types.js'

const events: RestoreMachineEvent[] = [
  { type: 'SIMULATE' },
  { type: 'RESTORE_NEEDED', keys: [] },
  { type: 'NO_RESTORE_NEEDED' },
  { type: 'SIGN_RESTORE' },
  { type: 'SUBMIT_RESTORE' },
  { type: 'CONFIRM_RESTORE' },
  { type: 'SIGN_ORIGINAL' },
  { type: 'SUBMIT_ORIGINAL' },
  { type: 'SUCCESS' },
  { type: 'FAIL', error: 'model failure' },
  { type: 'RESET' },
  { type: 'ESTIMATE' },
  { type: 'WATCH_TTL' },
  { type: 'EXTEND_TTL' },
]

const setup: Record<RestoreState, RestoreMachineEvent[]> = {
  idle: [],
  simulating: [{ type: 'SIMULATE' }],
  restore_needed: [{ type: 'SIMULATE' }, { type: 'RESTORE_NEEDED', keys: [] }],
  signing_restore: [
    { type: 'SIMULATE' },
    { type: 'RESTORE_NEEDED', keys: [] },
    { type: 'SIGN_RESTORE' },
  ],
  submitting_restore: [
    { type: 'SIMULATE' },
    { type: 'RESTORE_NEEDED', keys: [] },
    { type: 'SIGN_RESTORE' },
    { type: 'SUBMIT_RESTORE' },
  ],
  confirming_restore: [
    { type: 'SIMULATE' },
    { type: 'RESTORE_NEEDED', keys: [] },
    { type: 'SIGN_RESTORE' },
    { type: 'SUBMIT_RESTORE' },
    { type: 'CONFIRM_RESTORE' },
  ],
  signing_original: [{ type: 'SIMULATE' }, { type: 'NO_RESTORE_NEEDED' }],
  submitting_original: [
    { type: 'SIMULATE' },
    { type: 'NO_RESTORE_NEEDED' },
    { type: 'SUBMIT_ORIGINAL' },
  ],
  success: [{ type: 'SIMULATE' }, { type: 'SUCCESS' }],
  error: [{ type: 'SIMULATE' }, { type: 'FAIL', error: 'setup failure' }],
  estimating: [{ type: 'ESTIMATE' }],
  watching_ttl: [{ type: 'WATCH_TTL' }],
  extending_ttl: [{ type: 'EXTEND_TTL' }],
}

const transitions: Partial<
  Record<RestoreState, Partial<Record<RestoreMachineEvent['type'], RestoreState>>>
> = {
  idle: {
    SIMULATE: 'simulating',
    RESET: 'idle',
    ESTIMATE: 'estimating',
    WATCH_TTL: 'watching_ttl',
    EXTEND_TTL: 'extending_ttl',
  },
  simulating: {
    RESTORE_NEEDED: 'restore_needed',
    NO_RESTORE_NEEDED: 'signing_original',
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  restore_needed: {
    SIGN_RESTORE: 'signing_restore',
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  signing_restore: {
    SUBMIT_RESTORE: 'submitting_restore',
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  submitting_restore: {
    CONFIRM_RESTORE: 'confirming_restore',
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  confirming_restore: {
    SIGN_ORIGINAL: 'signing_original',
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  signing_original: {
    SUBMIT_ORIGINAL: 'submitting_original',
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  submitting_original: {
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  estimating: {
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  watching_ttl: {
    EXTEND_TTL: 'extending_ttl',
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  extending_ttl: {
    FAIL: 'error',
    SUCCESS: 'success',
    RESET: 'idle',
  },
  success: { RESET: 'idle' },
  error: { RESET: 'idle' },
}

const cases = Object.entries(setup).flatMap(([state, eventsToReach]) =>
  events.map((event) => [state as RestoreState, eventsToReach, event] as const),
)

describe('restore machine transition model', () => {
  it.each(cases)('%s + %s follows the transition model', (source, path, event) => {
    const service = createRestoreService()
    for (const setupEvent of path) service.send(setupEvent)

    service.send(event)

    const expected = transitions[source]?.[event.type] ?? source
    expect(service.state.value).toBe(expected)
    service.stop()
  })
})
