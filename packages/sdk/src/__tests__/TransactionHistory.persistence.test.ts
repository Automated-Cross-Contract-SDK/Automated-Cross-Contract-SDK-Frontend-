import { describe, it, expect, vi } from 'vitest'
import {
  Account,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { TransactionHistory } from '../TransactionHistory.js'
import { attachHistoryPersistence } from '../HistoryPersistence.js'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { HistoryStorage } from '../types.js'
import type { ResurrectResult } from '../types.js'

function makeTx(): Transaction {
  const account = new Account(Keypair.random().publicKey(), '1')
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
}

/** In-memory AsyncStorage stand-in. */
function makeStorage(
  seed: Record<string, string> = {},
): HistoryStorage & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(seed))
  return {
    store,
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('TransactionHistory serialization', () => {
  it('round-trips entries through toJSON / loadJSON', () => {
    const history = new TransactionHistory(Networks.TESTNET)
    const tx = makeTx()
    const id = history.add(tx)
    history.update(id, {
      success: false,
      archivedKeysDetected: 1,
      error: 'boom',
    } as ResurrectResult)

    const json = history.toJSON()
    const restored = new TransactionHistory(Networks.TESTNET)
    restored.loadJSON(json)

    const entry = restored.get(id)
    expect(entry).toBeDefined()
    expect(entry?.status).toBe('failed')
    expect(entry?.transaction.toXDR()).toBe(tx.toXDR())
  })

  it('loadJSON ignores malformed input and requires a passphrase', () => {
    const noPass = new TransactionHistory()
    expect(() => noPass.loadJSON('not json')).not.toThrow()
    expect(noPass.size).toBe(0)

    const withPass = new TransactionHistory(Networks.TESTNET)
    withPass.loadJSON(null)
    expect(withPass.size).toBe(0)
  })
})

describe('attachHistoryPersistence', () => {
  it('hydrates history from storage on attach', async () => {
    const seedHistory = new TransactionHistory(Networks.TESTNET)
    const id = seedHistory.add(makeTx())
    const storage = makeStorage({ 'soroban-resurrect:history': seedHistory.toJSON() })

    const history = new TransactionHistory(Networks.TESTNET)
    const handle = attachHistoryPersistence(history, storage)
    await handle.hydrated

    expect(history.size).toBe(1)
    expect(history.get(id)).toBeDefined()
  })

  it('persists on every change and survives a simulated restart', async () => {
    const storage = makeStorage()

    // First app session.
    const first = new TransactionHistory(Networks.TESTNET)
    const h1 = attachHistoryPersistence(first, storage)
    await h1.hydrated
    const id = first.add(makeTx())
    first.update(id, { success: false, archivedKeysDetected: 0, error: 'x' } as ResurrectResult)
    await flush()
    expect(storage.setItem).toHaveBeenCalled()
    h1.detach()

    // Simulated restart: brand-new history, same storage.
    const second = new TransactionHistory(Networks.TESTNET)
    const h2 = attachHistoryPersistence(second, storage)
    await h2.hydrated

    const recovered = second.get(id)
    expect(recovered?.status).toBe('failed')

    // A retry recorded after restart is written back too.
    second.incrementAttempt(id)
    await flush()
    const persisted = JSON.parse(storage.store.get('soroban-resurrect:history')!)
    expect(persisted[0].attemptCount).toBe(2)
  })

  it('detach stops further writes', async () => {
    const storage = makeStorage()
    const history = new TransactionHistory(Networks.TESTNET)
    const handle = attachHistoryPersistence(history, storage)
    await handle.hydrated
    handle.detach()

    history.add(makeTx())
    await flush()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('dispose detaches SDK history persistence', async () => {
    const storage = makeStorage()
    const sdk = new SorobanResurrect({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
      persistHistory: { storage },
    })
    await sdk.ready

    sdk.dispose()
    sdk.clearHistory()
    await flush()

    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('accepts synchronous Web Storage-style adapters', async () => {
    const values = new Map<string, string>()
    const storage: HistoryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
    }
    const history = new TransactionHistory(Networks.TESTNET)
    const handle = attachHistoryPersistence(history, storage)
    await handle.hydrated

    history.add(makeTx())
    await flush()

    expect(JSON.parse(values.get('soroban-resurrect:history')!)).toHaveLength(1)
    handle.detach()
  })

  it('keeps storage write failures best-effort', async () => {
    const storage: HistoryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable')
      },
    }
    const history = new TransactionHistory(Networks.TESTNET)
    const handle = attachHistoryPersistence(history, storage)
    await handle.hydrated

    expect(() => history.add(makeTx())).not.toThrow()
    await flush()
    handle.detach()
  })
})
