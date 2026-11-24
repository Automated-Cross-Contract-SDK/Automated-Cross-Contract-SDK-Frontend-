import { describe, it, expect, vi } from 'vitest'
import {
  Account,
  Keypair,
  Memo,
  Networks,
  Transaction,
  SorobanDataBuilder,
  rpc,
} from '@stellar/stellar-sdk'
import { buildRestoreTransaction, resolveRestoreMemo } from '../Restorer.js'

function makeMockServer(): rpc.Server {
  return {
    getAccount: vi.fn(),
    getTransaction: vi.fn(),
    simulateTransaction: vi.fn(),
  } as unknown as rpc.Server
}

async function build(configExtra: Record<string, unknown>, memo?: Memo): Promise<Transaction> {
  const server = makeMockServer()
  const kp = Keypair.random()
  vi.mocked(server.getAccount).mockResolvedValue(new Account(kp.publicKey(), '1') as never)

  return buildRestoreTransaction({
    server,
    sourcePublicKey: kp.publicKey(),
    transactionData: new SorobanDataBuilder().build(),
    minResourceFee: 100,
    latestLedger: 100,
    config: { rpcUrl: 'https://test', networkPassphrase: Networks.TESTNET, ...configExtra },
    ...(memo ? { memo } : {}),
  })
}

describe('restore transaction memo (#245)', () => {
  it.each([
    ['config.restoreTxMemo', { restoreTxMemo: Memo.text('archive restore') }, undefined],
    ['config.restoreTxMemoText', { restoreTxMemoText: 'why am I signing this' }, undefined],
    ['an explicit memo param', {}, Memo.id('42')],
  ])('rejects %s because the network refuses Soroban memos', async (_name, config, memo) => {
    await expect(build(config, memo)).rejects.toMatchObject({ code: 'INVALID_RESTORE_MEMO' })
  })

  it('defaults to no memo (no behaviour change for existing users)', async () => {
    const tx = await build({})
    expect(tx.memo.type).toBe('none')
  })

  it('treats an empty restoreTxMemoText as "no memo"', async () => {
    const tx = await build({ restoreTxMemoText: '' })
    expect(tx.memo.type).toBe('none')
  })
})

describe('resolveRestoreMemo', () => {
  it('accepts only an absent or none memo', () => {
    expect(resolveRestoreMemo(undefined, {})).toBeUndefined()
    expect(resolveRestoreMemo(Memo.none(), {})?.type).toBe('none')
    expect(() => resolveRestoreMemo(undefined, { restoreTxMemoText: 'txt' })).toThrow(
      /cannot carry a memo/,
    )
  })
})
