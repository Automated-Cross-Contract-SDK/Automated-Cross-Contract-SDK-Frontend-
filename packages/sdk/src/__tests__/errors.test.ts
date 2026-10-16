import { describe, expect, it } from 'vitest'
import {
  getResurrectErrorCode,
  InvalidInputError,
  NetworkError,
  ResurrectError,
  ResurrectErrorCode,
  ResurrectTimeoutError,
  RestoreError,
  SigningError,
  SimulationError,
  wrapSigningError,
} from '../errors.js'

describe('typed SDK errors', () => {
  it.each([
    [NetworkError, ResurrectErrorCode.NETWORK_ERROR],
    [SimulationError, ResurrectErrorCode.SIMULATION_FAILED],
    [SigningError, ResurrectErrorCode.SIGNING_FAILED],
    [RestoreError, ResurrectErrorCode.RESTORE_TX_FAILED],
    [ResurrectTimeoutError, ResurrectErrorCode.TIMEOUT],
    [InvalidInputError, ResurrectErrorCode.INVALID_INPUT],
  ])('%s exposes its stable code and message', (ErrorType, code) => {
    const error = new ErrorType('failure')

    expect(error).toBeInstanceOf(ResurrectError)
    expect(error.code).toBe(code)
    expect(error.message).toBe('failure')
  })

  it('preserves an existing structured error code when normalizing', () => {
    const error = new ResurrectTimeoutError('expired')
    expect(getResurrectErrorCode(error)).toBe(ResurrectErrorCode.TIMEOUT)
    expect(getResurrectErrorCode({ code: ResurrectErrorCode.RPC_TIMEOUT }))
      .toBe(ResurrectErrorCode.RPC_TIMEOUT)
    expect(getResurrectErrorCode(new Error('unexpected')))
      .toBe(ResurrectErrorCode.UNKNOWN_ERROR)
  })

  it('normalizes rejected signing operations without replacing structured errors', async () => {
    await expect(wrapSigningError(async () => Promise.reject(new Error('user declined'))))
      .rejects.toMatchObject({
        name: 'SigningError',
        code: ResurrectErrorCode.SIGNING_FAILED,
        message: 'user declined',
      })

    const structured = new ResurrectTimeoutError('expired')
    await expect(wrapSigningError(async () => Promise.reject(structured))).rejects.toBe(structured)
  })
})
