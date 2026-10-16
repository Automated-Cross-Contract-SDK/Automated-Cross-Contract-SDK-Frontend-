import { describe, expect, it } from 'vitest'

import {
  toResult,
  toResultAsync,
  extractArchivedKeysSafe,
  extractFootprintFromSuccessSafe,
  isErr,
  isOk,
  isResurrectFailure,
  isResurrectSuccess,
  matchResurrectResult,
  ok,
  err,
} from '../result.js'
import type { ResurrectResult } from '../types.js'

describe('result helpers', () => {
  it('narrows workflow successes and failures and matches exhaustively', () => {
    const success: ResurrectResult = { success: true, archivedKeysDetected: 0 }
    const failure: ResurrectResult = {
      success: false,
      archivedKeysDetected: 0,
      error: 'deadline exceeded',
      errorCode: 'TIMEOUT',
    }

    expect(isResurrectSuccess(success)).toBe(true)
    expect(isResurrectFailure(success)).toBe(false)
    expect(isResurrectFailure(failure)).toBe(true)
    expect(
      matchResurrectResult(failure, {
        success: (result) => result.originalTxHash ?? 'submitted',
        failure: (result) => result.errorCode,
      }),
    ).toBe('TIMEOUT')
  })

  it('provides free type guards for Result branches', () => {
    const success = ok(42)
    const failure = err(new Error('failed'))
    expect(isOk(success)).toBe(true)
    expect(isErr(success)).toBe(false)
    expect(isErr(failure)).toBe(true)
  })

  it('captures thrown values in a typed Result', () => {
    const outcome = toResult(() => {
      throw new Error('boom')
    })

    expect(outcome.isErr()).toBe(true)
    expect(outcome._unsafeUnwrapErr().message).toBe('boom')
  })

  it('captures async thrown values in a typed Result', async () => {
    const outcome = await toResultAsync(async () => {
      throw new Error('async boom')
    })

    expect(outcome.isErr()).toBe(true)
    expect(outcome._unsafeUnwrapErr().message).toBe('async boom')
  })

  it('returns a safe result for archive extraction failures', () => {
    const response = {
      _parsed: false,
    } as any

    const outcome = extractArchivedKeysSafe(response)

    expect(outcome.isOk()).toBe(true)
    expect(outcome._unsafeUnwrap()).toEqual([])
  })

  it('returns a safe result for footprint extraction failures', () => {
    const response = {
      _parsed: false,
    } as any

    const outcome = extractFootprintFromSuccessSafe(response)

    expect(outcome.isOk()).toBe(true)
    expect(outcome._unsafeUnwrap()).toEqual({ readOnly: [], readWrite: [] })
  })
})
