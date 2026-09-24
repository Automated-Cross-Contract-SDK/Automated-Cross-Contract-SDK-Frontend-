import { rpc, xdr } from '@stellar/stellar-sdk'

import { asXdrBase64 } from './branded-types.js'
import type { ArchivedLedgerEntry } from './types.js'

export type Result<T, E = Error> = Ok<T, E> | Err<T, E>
export type Option<T> = Some<T> | None<T>

export class Ok<T, E = Error> {
  readonly ok = true as const

  constructor(public value: T) {}

  isOk(): this is Ok<T, E> {
    return true
  }

  isErr(): this is Err<T, E> {
    return false
  }

  unwrap(): T {
    return this.value
  }

  unwrapErr(): E {
    throw new Error('Tried to unwrapErr on Ok result')
  }

  _unsafeUnwrap(): T {
    return this.value
  }

  _unsafeUnwrapErr(): E {
    throw new Error('Tried to unwrapErr on Ok result')
  }

  map<U>(mapper: (value: T) => U): Result<U, E> {
    return ok(mapper(this.value))
  }

  mapErr<F>(_: (error: E) => F): Result<T, F> {
    return ok(this.value)
  }

  andThen<U>(mapper: (value: T) => Result<U, E>): Result<U, E> {
    return mapper(this.value)
  }

  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    return handlers.ok(this.value)
  }
}

export class Err<T, E = Error> {
  readonly ok = false as const

  constructor(public error: E) {}

  isOk(): this is Ok<T, E> {
    return false
  }

  isErr(): this is Err<T, E> {
    return true
  }

  unwrap(): T {
    throw new Error(`Tried to unwrap Err: ${String(this.error)}`)
  }

  unwrapErr(): E {
    return this.error
  }

  _unsafeUnwrap(): T {
    throw new Error(`Tried to unwrap Err: ${String(this.error)}`)
  }

  _unsafeUnwrapErr(): E {
    return this.error
  }

  map<U>(_: (value: T) => U): Result<U, E> {
    return err(this.error)
  }

  mapErr<F>(mapper: (error: E) => F): Result<T, F> {
    return err(mapper(this.error))
  }

  andThen<U>(_: (value: T) => Result<U, E>): Result<U, E> {
    return err(this.error)
  }

  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    return handlers.err(this.error)
  }
}

export class Some<T> {
  readonly some = true as const

  constructor(public value: T) {}

  isSome(): this is Some<T> {
    return true
  }

  isNone(): this is None<T> {
    return false
  }

  unwrap(): T {
    return this.value
  }

  map<U>(mapper: (value: T) => U): Option<U> {
    return some(mapper(this.value))
  }

  andThen<U>(mapper: (value: T) => Option<U>): Option<U> {
    return mapper(this.value)
  }

  match<U>(handlers: { some: (value: T) => U; none: () => U }): U {
    return handlers.some(this.value)
  }
}

export class None<T> {
  readonly some = false as const

  isSome(): this is Some<T> {
    return false
  }

  isNone(): this is None<T> {
    return true
  }

  unwrap(): T {
    throw new Error('Tried to unwrap None')
  }

  map<U>(_: (value: T) => U): Option<U> {
    return none()
  }

  andThen<U>(_: (value: T) => Option<U>): Option<U> {
    return none()
  }

  match<U>(handlers: { some: (value: T) => U; none: () => U }): U {
    return handlers.none()
  }
}

export const ok = <T, E = Error>(value: T): Result<T, E> => new Ok(value)
export const err = <T, E = Error>(error: E): Result<T, E> => new Err(error)
export const some = <T>(value: T): Option<T> => new Some(value)
export const none = <T>(): Option<T> => new None()

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value
  }

  if (typeof value === 'string') {
    return new Error(value)
  }

  return new Error(String(value))
}

export function toResult<T, E = Error>(fn: () => T): Result<T, E> {
  try {
    return ok(fn()) as Result<T, E>
  } catch (error) {
    return err(toError(error) as E)
  }
}

export async function toResultAsync<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>> {
  try {
    return ok(await fn()) as Result<T, E>
  } catch (error) {
    return err(toError(error) as E)
  }
}

export function fromNullable<T>(value: T | null | undefined): Option<T> {
  return value == null ? none<T>() : some(value)
}

export function extractArchivedKeysSafe(
  response: rpc.Api.SimulateTransactionRestoreResponse,
): Result<ArchivedLedgerEntry[], Error> {
  return toResult(() => {
    const keys: ArchivedLedgerEntry[] = []

    if (!response._parsed) {
      console.warn(
        'SorobanResurrect: restore simulation response has _parsed=false, cannot extract archived keys',
      )
      return keys
    }

    try {
      const footprint = response.transactionData.getFootprint()
      const readWrite = footprint.readWrite()

      for (const ledgerKey of readWrite) {
        const keyBase64 = asXdrBase64(ledgerKey.toXDR('base64'))
        keys.push({ key: ledgerKey, keyBase64 })
      }
    } catch {
      return keys
    }

    return keys
  })
}

export function extractFootprintFromSuccessSafe(
  response: rpc.Api.SimulateTransactionSuccessResponse,
): Result<{ readOnly: xdr.LedgerKey[]; readWrite: xdr.LedgerKey[] }, Error> {
  return toResult(() => {
    if (!response._parsed) {
      console.warn(
        'SorobanResurrect: success simulation response has _parsed=false, cannot extract footprint',
      )
      return { readOnly: [], readWrite: [] }
    }

    try {
      const footprint = response.transactionData.getFootprint()
      return {
        readOnly: footprint.readOnly() || [],
        readWrite: footprint.readWrite() || [],
      }
    } catch {
      return { readOnly: [], readWrite: [] }
    }
  })
}
