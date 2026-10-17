/** Options shared by SDK operations that can be cancelled by a caller. */
export interface AbortSignalOptions {
  /** Stops the operation and prevents subsequent workflow steps. */
  signal?: AbortSignal
}

/** Creates the standard error returned when a signal aborts an operation. */
export function createAbortError(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error) return reason

  const error = new Error(typeof reason === 'string' ? reason : 'The operation was aborted')
  error.name = 'AbortError'
  return error
}

/** Throws the signal reason when the caller has already cancelled. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal)
  }
}

/**
 * Stops waiting for a promise when the caller aborts, and always removes the
 * temporary abort listener when either side settles.
 */
export function awaitWithSignal<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(operation)
  throwIfAborted(signal)

  return new Promise<T>((resolve, reject) => {
    let settled = false

    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
    }

    const onAbort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(createAbortError(signal))
    }

    signal.addEventListener('abort', onAbort, { once: true })

    Promise.resolve(operation).then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )

    if (signal.aborted) onAbort()
  })
}

/** Checks the signal before starting work, then races the work against abort. */
export function runWithSignal<T>(
  operation: () => PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal)
  return awaitWithSignal(operation(), signal)
}

/** A cancellable delay that clears its timer and abort listener on settlement. */
export function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
  throwIfAborted(signal)

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }

    const onAbort = (): void => {
      cleanup()
      reject(createAbortError(signal))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}
