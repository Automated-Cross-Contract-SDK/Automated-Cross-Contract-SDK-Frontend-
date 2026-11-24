import { ResurrectTimeoutError } from './errors.js'

export async function withPhaseTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number | undefined,
  phase: string,
): Promise<T> {
  if (timeoutMs === undefined) return operation
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ResurrectTimeoutError(`${phase} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
