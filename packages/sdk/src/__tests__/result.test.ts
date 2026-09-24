import { describe, expect, it } from 'vitest'

import {
  toResult,
  toResultAsync,
  extractArchivedKeysSafe,
  extractFootprintFromSuccessSafe,
} from '../result.js'

describe('result helpers', () => {
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
