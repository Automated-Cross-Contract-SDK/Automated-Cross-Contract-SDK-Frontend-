import { ResurrectError } from './errors.js'

export function assertBatchSize(
  actual: number,
  maximum: number,
  operation: string,
): void {
  if (actual > maximum) {
    throw new ResurrectError(
      'BATCH_SIZE_EXCEEDED',
      `${operation} accepts at most ${maximum} items; received ${actual}.`,
    )
  }
}

export async function settleBatchWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      try {
        results[index] = { status: 'fulfilled', value: await run(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  return results
}
