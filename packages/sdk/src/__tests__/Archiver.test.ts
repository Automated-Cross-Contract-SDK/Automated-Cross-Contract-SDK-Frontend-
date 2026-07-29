import { describe, it, expect, vi } from 'vitest'
import { rpc, SorobanDataBuilder, xdr } from '@stellar/stellar-sdk'
import {
  isRestoreResponse,
  isSuccessResponse,
  isErrorResponse,
  extractArchivedKeys,
  extractFootprintFromSuccess,
  detectArchivedEntries,
  detectArchivedKeysViaSimulation,
  detectArchivedKeysViaDirect,
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

    it('returns empty array for an explicitly empty readWrite array', () => {
      const response = makeMockRestoreResponse()
      Object.defineProperty(response.transactionData, 'getFootprint', {
        value: () => ({ readOnly: () => [], readWrite: () => [] }),
      })
      expect(extractArchivedKeys(response)).toEqual([])
    })

    it('returns empty array when the footprint itself is undefined', () => {
      const response = makeMockRestoreResponse()
      Object.defineProperty(response.transactionData, 'getFootprint', {
        value: () => undefined,
      })
      expect(extractArchivedKeys(response)).toEqual([])
    })

    it('returns empty array when readWrite() returns undefined', () => {
      const response = makeMockRestoreResponse()
      Object.defineProperty(response.transactionData, 'getFootprint', {
        value: () => ({ readOnly: () => [], readWrite: () => undefined }),
      })
      expect(extractArchivedKeys(response)).toEqual([])
    })

    it('returns empty array for a malformed response missing transactionData', () => {
      const response = { ...makeMockRestoreResponse(), transactionData: undefined } as never
      expect(extractArchivedKeys(response)).toEqual([])
    })

    it('warns and returns empty array when the response has _parsed=false', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const response = { ...makeMockRestoreResponse(), _parsed: false } as never
      expect(extractArchivedKeys(response)).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('_parsed=false'))
      warnSpy.mockRestore()
    })

    it('ignores readOnly entries and only extracts readWrite keys', () => {
      const readOnlyKey = { toXDR: () => 'read-only-key' }
      const readWriteKey = { toXDR: () => 'read-write-key' }
      const response = makeMockRestoreResponse()
      Object.defineProperty(response.transactionData, 'getFootprint', {
        value: () => ({ readOnly: () => [readOnlyKey], readWrite: () => [readWriteKey] }),
      })

      const keys = extractArchivedKeys(response)
      expect(keys.length).toBe(1)
      expect(keys[0].keyBase64).toBe('read-write-key')
    })

    it('extracts multiple archived keys from a restore response with several readWrite entries', () => {
      const key1 = { toXDR: () => 'key-1' }
      const key2 = { toXDR: () => 'key-2' }
      const key3 = { toXDR: () => 'key-3' }
      const response = makeMockRestoreResponse()
      Object.defineProperty(response.transactionData, 'getFootprint', {
        value: () => ({ readOnly: () => [], readWrite: () => [key1, key2, key3] }),
      })

      const keys = extractArchivedKeys(response)
      expect(keys.map((k) => k.keyBase64)).toEqual(['key-1', 'key-2', 'key-3'])
      expect(keys[0].key).toBe(key1)
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

  describe('detectArchivedKeysViaSimulation', () => {
    it('returns archived keys from restore response', async () => {
      const mockKey = { toXDR: () => 'base64-key' }
      const response = {
        ...makeMockRestoreResponse(),
        transactionData: {
          build: () => ({}),
          getFootprint: () => ({ readOnly: () => [], readWrite: () => [mockKey] }),
        },
      }

      const server = {
        simulateTransaction: vi.fn().mockResolvedValue(response),
      } as unknown as rpc.Server

      const mockTx = {} as any
      const result = await detectArchivedKeysViaSimulation(server, mockTx)

      expect(result.length).toBe(1)
      expect(result[0].keyBase64).toBe('base64-key')
    })

    it('returns empty array for success response', async () => {
      const server = {
        simulateTransaction: vi.fn().mockResolvedValue(makeMockSuccessResponse()),
      } as unknown as rpc.Server

      const result = await detectArchivedKeysViaSimulation(server, {} as any)
      expect(result).toEqual([])
    })

    it('returns empty array for error response', async () => {
      const server = {
        simulateTransaction: vi.fn().mockResolvedValue(makeMockErrorResponse()),
      } as unknown as rpc.Server

      const result = await detectArchivedKeysViaSimulation(server, {} as any)
      expect(result).toEqual([])
    })
  })

  describe('detectArchivedKeysViaDirect', () => {
    it('throws on simulation error response', async () => {
      const server = {
        simulateTransaction: vi.fn().mockResolvedValue(makeMockErrorResponse()),
      } as unknown as rpc.Server

      await expect(detectArchivedKeysViaDirect(server, {} as any)).rejects.toThrow('Simulation error')
    })

    it('throws on restore response', async () => {
      const server = {
        simulateTransaction: vi.fn().mockResolvedValue(makeMockRestoreResponse()),
      } as unknown as rpc.Server

      await expect(detectArchivedKeysViaDirect(server, {} as any)).rejects.toThrow(
        'Archived entries already detected via simulation restore response',
      )
    })

    it('returns empty when no readWrite entries', async () => {
      const server = {
        simulateTransaction: vi.fn().mockResolvedValue({
          ...makeMockSuccessResponse(),
          transactionData: {
            build: () => ({}),
            getFootprint: () => ({ readOnly: () => [], readWrite: () => [] }),
          },
        }),
      } as unknown as rpc.Server

      const result = await detectArchivedKeysViaDirect(server, {} as any)
      expect(result).toEqual([])
    })

    it('detects archived entries from success response footprint', async () => {
      const archivedKey = { toXDR: () => 'base64-archived' } as unknown as xdr.LedgerKey
      const liveKey = { toXDR: () => 'base64-live' } as unknown as xdr.LedgerKey

      const server = {
        simulateTransaction: vi.fn().mockResolvedValue({
          ...makeMockSuccessResponse(),
          transactionData: {
            build: () => ({}),
            getFootprint: () => ({ readOnly: () => [], readWrite: () => [liveKey, archivedKey] }),
          },
        }),
        getLedgerEntries: vi.fn().mockResolvedValue({
          entries: [{ key: liveKey }],
        }),
      } as unknown as rpc.Server

      const result = await detectArchivedKeysViaDirect(server, {} as any)
      expect(result.length).toBe(1)
      expect(result[0].keyBase64).toBe('base64-archived')
    })
  })
})
