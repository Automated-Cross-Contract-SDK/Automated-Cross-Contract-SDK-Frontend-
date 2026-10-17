import { describe, expect, it } from 'vitest'
import { Memo } from '@stellar/stellar-sdk'
import { resolveConfig } from '../SorobanResurrectConfig.js'
import { ResurrectError } from '../errors.js'

const rpcUrl = 'https://soroban-testnet.stellar.org'

describe('restore memo config validation', () => {
  it('rejects a 29-byte text memo during config resolution', () => {
    try {
      resolveConfig({ rpcUrl, restoreTxMemoText: 'a'.repeat(29) })
      throw new Error('expected invalid memo to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(ResurrectError)
      expect(error).toMatchObject({ code: 'INVALID_RESTORE_MEMO' })
      expect((error as Error).message).toContain('"restoreTxMemoText"')
      expect((error as Error).message).toContain('28 bytes')
    }
  })

  it('measures multi-byte text by UTF-8 bytes', () => {
    expect(() => resolveConfig({ rpcUrl, restoreTxMemoText: 'é'.repeat(14) })).not.toThrow()
    expect(() => resolveConfig({ rpcUrl, restoreTxMemoText: 'é'.repeat(15) })).toThrow(
      /30 UTF-8 bytes/,
    )
  })

  it('rejects memo variants that do not apply to restoreFootprint', () => {
    expect(() => resolveConfig({ rpcUrl, restoreTxMemo: Memo.id('42') })).toThrow(
      /restoreTxMemo.*does not apply to restoreFootprint/,
    )
  })
})
