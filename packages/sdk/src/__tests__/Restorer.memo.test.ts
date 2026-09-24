import { describe, it, expect, vi } from 'vitest'
import { Account, Keypair, Memo, Networks, Transaction, SorobanDataBuilder, rpc } from '@stellar/stellar-sdk'
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
    config: { rpcUrl: 'https://test', networkPassphrase: Networks.TESTNET, ...configExtra },
    ...(memo ? { memo } : {}),
  })
}

describe('restore transaction memo (#245)', () => {
  it('attaches config.restoreTxMemo to the built restore tx', async () => {
    const tx = await build({ restoreTxMemo: Memo.text('archive restore') })
    expect(tx.memo.type).toBe('text')
    expect(tx.memo.value?.toString()).toBe('archive restore')
  })

  it('attaches config.restoreTxMemoText as a text memo', async () => {
    const tx = await build({ restoreTxMemoText: 'why am I signing this' })
    expect(tx.memo.type).toBe('text')
    expect(tx.memo.value?.toString()).toBe('why am I signing this')
  })

  it('lets an explicit memo param win over config', async () => {
    const tx = await build({ restoreTxMemoText: 'from config' }, Memo.id('42'))
    expect(tx.memo.type).toBe('id')
    expect(tx.memo.value).toBe('42')
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
  it('precedence: explicit > restoreTxMemo > restoreTxMemoText > undefined', () => {
    const explicit = Memo.text('explicit')
    const configMemo = Memo.text('config-memo')

    expect(resolveRestoreMemo(explicit, { restoreTxMemo: configMemo, restoreTxMemoText: 'txt' })).toBe(explicit)
    expect(resolveRestoreMemo(undefined, { restoreTxMemo: configMemo, restoreTxMemoText: 'txt' })).toBe(configMemo)
    expect(resolveRestoreMemo(undefined, { restoreTxMemoText: 'txt' })?.value?.toString()).toBe('txt')
    expect(resolveRestoreMemo(undefined, {})).toBeUndefined()
  })
})
