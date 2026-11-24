import { describe, expect, it } from 'vitest'
import { Memo } from '@stellar/stellar-sdk'
import { resolveConfig } from '../SorobanResurrectConfig.js'

const rpcUrl = 'https://soroban-testnet.stellar.org'

describe('restore memo config validation', () => {
  it.each([
    { restoreTxMemoText: 'a' },
    { restoreTxMemo: Memo.text('a') },
    { restoreTxMemo: Memo.id('42') },
  ])('rejects %o during config resolution', (memo) => {
    expect(() => resolveConfig({ rpcUrl, ...memo })).toThrow(
      expect.objectContaining({ code: 'INVALID_RESTORE_MEMO' }),
    )
  })

  it('accepts an empty text or none memo', () => {
    expect(() =>
      resolveConfig({ rpcUrl, restoreTxMemoText: '', restoreTxMemo: Memo.none() }),
    ).not.toThrow()
  })
})
