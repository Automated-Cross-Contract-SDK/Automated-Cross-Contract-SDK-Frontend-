import { describe, expect, it } from 'vitest'
import { ResurrectError } from '../errors.js'
import { assertBatchSize, settleBatchWithConcurrency } from '../batchLimits.js'

describe('batch request bounds', () => {
  it('limits concurrent detection requests and preserves result order', async () => {
    let active = 0
    let maximumActive = 0
    const results = await settleBatchWithConcurrency(
      Array.from({ length: 8 }, (_, index) => index),
      2,
      async (item) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return item * 2
      },
    )

    expect(maximumActive).toBe(2)
    expect(results).toEqual(
      Array.from({ length: 8 }, (_, index) => ({ status: 'fulfilled', value: index * 2 })),
    )
  })

  it('returns ordered partial results when one item fails', async () => {
    const results = await settleBatchWithConcurrency(
      [0, 1, 2],
      2,
      async (item) => {
        if (item === 1) throw new Error('request failed')
        return item
      },
    )

    expect(results[0]).toEqual({ status: 'fulfilled', value: 0 })
    expect(results[1].status).toBe('rejected')
    if (results[1].status === 'rejected') {
      expect(results[1].reason).toBeInstanceOf(Error)
      expect(results[1].reason.message).toBe('request failed')
    }
    expect(results[2]).toEqual({ status: 'fulfilled', value: 2 })
  })

  it('rejects batch sizes over the configured maximum with a typed error', () => {
    try {
      assertBatchSize(3, 2, 'restoreKeys')
      throw new Error('expected oversized batch to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ResurrectError)
      expect(error).toMatchObject({
        code: 'BATCH_SIZE_EXCEEDED',
        message: 'restoreKeys accepts at most 2 items; received 3.',
      })
    }
    expect(() => assertBatchSize(2, 2, 'restoreKeys')).not.toThrow()
  })
})
