import { describe, it, expect, vi } from 'vitest'
import { rpc, SorobanDataBuilder, xdr } from '@stellar/stellar-sdk'
import {
  isRestoreResponse,
  isSuccessResponse,
  isErrorResponse,
  extractArchivedKeys,
  extractFootprintFromSuccess,
  detectArchivedEntries,
} from '../Archiver.js'

function makeMockSuccessResponse(): rpc.Api.SimulateTransactionSuccessResponse {
  const sorobanData = new SorobanDataBuilder()
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: sorobanData,
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
  }
}

function makeMockRestoreResponse(): rpc.Api.SimulateTransactionRestoreResponse {
  const sorobanData = new SorobanDataBuilder()
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: sorobanData,
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
    restorePreamble: {
      minResourceFee: '100',
      transactionData: new SorobanDataBuilder(),
    },
  }
}

function makeMockErrorResponse(): rpc.Api.SimulateTransactionErrorResponse {
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    error: 'simulation failed',
  }
}

describe('Archiver', () => {
  describe('isRestoreResponse', () => {
    it('returns true for restore response', () => {
      expect(isRestoreResponse(makeMockRestoreResponse())).toBe(true)
    })

    it('returns false for success response', () => {
      expect(isRestoreResponse(makeMockSuccessResponse())).toBe(false)
    })

    it('returns false for error response', () => {
      expect(isRestoreResponse(makeMockErrorResponse())).toBe(false)
    })
  })

  describe('isSuccessResponse', () => {
    it('returns true for restore response (restore extends success)', () => {
      expect(isSuccessResponse(makeMockRestoreResponse())).toBe(true)
    })

    it('returns true for success response', () => {
      expect(isSuccessResponse(makeMockSuccessResponse())).toBe(true)
    })

    it('returns false for error response', () => {
      expect(isSuccessResponse(makeMockErrorResponse())).toBe(false)
    })
  })

  describe('isErrorResponse', () => {
    it('returns false for restore response', () => {
      expect(isErrorResponse(makeMockRestoreResponse())).toBe(false)
    })

    it('returns false for success response', () => {
      expect(isErrorResponse(makeMockSuccessResponse())).toBe(false)
    })

    it('returns true for error response', () => {
      expect(isErrorResponse(makeMockErrorResponse())).toBe(true)
    })
  })

  describe('extractArchivedKeys', () => {
    it('returns empty array when footprint has no readWrite entries', () => {
      const keys = extractArchivedKeys(makeMockRestoreResponse())
      expect(keys).toEqual([])
    })

    it('returns empty array gracefully on parse failure', () => {
      const response = makeMockRestoreResponse()
      Object.defineProperty(response.transactionData, 'getFootprint', {
        value: () => {
          throw new Error('bad data')
        },
      })
      expect(extractArchivedKeys(response)).toEqual([])
    })
  })

  describe('detectArchivedEntries', () => {
    it('returns empty array when all entries are live', async () => {
      const key1 = { toXDR: () => 'base64-1' } as unknown as xdr.LedgerKey
      const key2 = { toXDR: () => 'base64-2' } as unknown as xdr.LedgerKey
      const server = {
        getLedgerEntries: vi.fn().mockResolvedValue({
          entries: [{ key: key1 }, { key: key2 }],
        }),
      } as unknown as rpc.Server

      const keys = [key1, key2]

      const result = await detectArchivedEntries(server, keys)
      expect(result).toEqual([])
    })

    it('detects archived entries when ledger entries are missing', async () => {
      const existingKey = { toXDR: () => 'base64-1' } as unknown as xdr.LedgerKey
      const missingKey = { toXDR: () => 'base64-2' } as unknown as xdr.LedgerKey
      const server = {
        getLedgerEntries: vi.fn().mockResolvedValue({
          entries: [{ key: existingKey }],
        }),
      } as unknown as rpc.Server

      const keys = [existingKey, missingKey]

      const result = await detectArchivedEntries(server, keys)
      expect(result.length).toBe(1)
      expect(result[0].keyBase64).toBe('base64-2')
    })

    it('treats all keys in a chunk as archived when the request fails', async () => {
      const server = {
        getLedgerEntries: vi.fn().mockRejectedValue(new Error('network error')),
      } as unknown as rpc.Server

      const mockKey = { toXDR: () => 'base64-xdr' } as unknown as xdr.LedgerKey
      const keys = [mockKey]

      const result = await detectArchivedEntries(server, keys)
      expect(result.length).toBe(1)
    })
  })

  describe('extractFootprintFromSuccess', () => {
    it('returns empty footprint when no data', () => {
      const result = extractFootprintFromSuccess(makeMockSuccessResponse())
      expect(result.readOnly).toEqual([])
      expect(result.readWrite).toEqual([])
    })

    it('returns empty on parse failure', () => {
      const response = makeMockSuccessResponse()
      Object.defineProperty(response.transactionData, 'getFootprint', {
        value: () => {
          throw new Error('bad')
        },
      })
      const result = extractFootprintFromSuccess(response)
      expect(result.readOnly).toEqual([])
      expect(result.readWrite).toEqual([])
    })
  })
})
