import { describe, expect, it } from 'vitest'
import { rpc } from '@stellar/stellar-sdk'
import { sorobanRpcResponseFixturesV1 as fixtures } from './fixtures/soroban-rpc/v1.js'

describe('versioned Soroban RPC response fixtures', () => {
  it('recognizes and extracts a successful simulation response', () => {
    const response = fixtures.success as unknown as rpc.Api.SimulateTransactionResponse

    expect(rpc.Api.isSimulationSuccess(response)).toBe(true)
    expect(rpc.Api.isSimulationRestore(response)).toBe(false)
    expect(rpc.Api.isSimulationError(response)).toBe(false)
    expect(
      (response as rpc.Api.SimulateTransactionSuccessResponse).transactionData
        .getFootprint()
        .readWrite(),
    ).toEqual([])
  })

  it('recognizes a restore response and extracts its archived footprint', () => {
    const response = fixtures.restore as unknown as rpc.Api.SimulateTransactionResponse

    expect(rpc.Api.isSimulationRestore(response)).toBe(true)
    expect(
      (response as rpc.Api.SimulateTransactionRestoreResponse).transactionData
        .getFootprint()
        .readWrite(),
    ).toEqual([expect.objectContaining({ toXDR: expect.any(Function) })])
  })

  it('recognizes RPC errors without treating them as success responses', () => {
    const response = fixtures.error as unknown as rpc.Api.SimulateTransactionResponse

    expect(rpc.Api.isSimulationError(response)).toBe(true)
    expect(rpc.Api.isSimulationSuccess(response)).toBe(false)
    expect(rpc.Api.isSimulationRestore(response)).toBe(false)
  })

  it('rejects malformed responses that do not match a known RPC shape', () => {
    const response = fixtures.malformed as unknown as rpc.Api.SimulateTransactionResponse

    expect(rpc.Api.isSimulationError(response)).toBe(false)
    expect(rpc.Api.isSimulationSuccess(response)).toBe(false)
    expect(rpc.Api.isSimulationRestore(response)).toBe(false)
  })

  it('continues to recognize success responses with extended RPC fields', () => {
    const response = fixtures.extendedSuccess as unknown as rpc.Api.SimulateTransactionResponse

    expect(rpc.Api.isSimulationSuccess(response)).toBe(true)
    expect(rpc.Api.isSimulationRestore(response)).toBe(false)
    expect(rpc.Api.isSimulationError(response)).toBe(false)
    expect(
      (response as rpc.Api.SimulateTransactionSuccessResponse).transactionData
        .getFootprint()
        .readWrite(),
    ).toEqual([])
  })
})
