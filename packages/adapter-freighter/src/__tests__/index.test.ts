import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import {
  isConnected as freighterIsConnected,
  requestAccess,
  getAddress,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api'
import type { WalletAdapterEvent } from '@soroban-resurrect/sdk'
import { FreighterAdapter } from '../index.js'
import { registerWalletAdapterContract } from '../../../testing/src/index.js'

vi.mock('@soroban-resurrect/sdk', async () => import('../../../testing/src/sdkTestModule.js'))

const watchState = vi.hoisted(() => ({
  callback: undefined as
    ((params: { address: string; network: string; networkPassphrase: string }) => void) | undefined,
  stop: vi.fn(),
}))

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  signTransaction: vi.fn(),
  WatchWalletChanges: vi.fn().mockImplementation(function () {
    return {
      watch: (callback: typeof watchState.callback) => {
        watchState.callback = callback
        return {}
      },
      stop: watchState.stop,
    }
  }),
}))

const mockIsConnected = vi.mocked(freighterIsConnected)
const mockRequestAccess = vi.mocked(requestAccess)
const mockGetAddress = vi.mocked(getAddress)
const mockSignTransaction = vi.mocked(freighterSignTransaction)

const ADDRESS = 'GABC00000000000000000000000000000000000000000000000FREIGHTER'
const SIGNED_XDR = 'AAAAfreighter++signed//xdr=='

describe('FreighterAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    watchState.callback = undefined
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({ address: ADDRESS })
    mockGetAddress.mockResolvedValue({ address: ADDRESS })
    mockSignTransaction.mockResolvedValue({ signedTxXdr: SIGNED_XDR, signerAddress: ADDRESS })
  })

  it('satisfies the WalletAdapter contract', () => {
    const adapter: WalletAdapter = new FreighterAdapter()
    expect(typeof adapter.isConnected).toBe('function')
    expect(typeof adapter.getPublicKey).toBe('function')
    expect(typeof adapter.signTransaction).toBe('function')
  })

  it('isConnected returns the boolean from the Freighter API', async () => {
    const adapter = new FreighterAdapter()
    expect(await adapter.isConnected()).toBe(true)

    mockIsConnected.mockResolvedValueOnce({ isConnected: false })
    expect(await adapter.isConnected()).toBe(false)
  })

  it('isConnected returns false when the Freighter API reports an error', async () => {
    mockIsConnected.mockResolvedValueOnce({ error: 'not installed' } as never)
    const adapter = new FreighterAdapter()
    expect(await adapter.isConnected()).toBe(false)
  })

  it('getPublicKey returns the granted address', async () => {
    const adapter = new FreighterAdapter()
    expect(await adapter.getPublicKey()).toBe(ADDRESS)
    expect(mockGetAddress).toHaveBeenCalledTimes(1)
    expect(mockRequestAccess).not.toHaveBeenCalled()
  })

  it('getPublicKey throws when access is denied', async () => {
    mockGetAddress.mockResolvedValueOnce({ error: 'account access denied' } as never)
    const adapter = new FreighterAdapter()
    await expect(adapter.getPublicKey()).rejects.toThrow('Freighter: account access denied')
  })

  it('connect requests account access explicitly', async () => {
    const adapter = new FreighterAdapter()
    expect(await adapter.connect()).toBe(ADDRESS)
    expect(mockRequestAccess).toHaveBeenCalledTimes(1)
  })

  it('signTransaction returns base64 XDR and forwards passphrase + address', async () => {
    const adapter = new FreighterAdapter()
    const result = await adapter.signTransaction('AAAAtx', {
      networkPassphrase: 'Test SDF Network ; September 2015',
    })

    expect(result).toBe(SIGNED_XDR)
    expect(mockSignTransaction).toHaveBeenCalledWith('AAAAtx', {
      networkPassphrase: 'Test SDF Network ; September 2015',
      address: ADDRESS,
    })
  })

  it('signTransaction throws when the wallet rejects signing', async () => {
    mockSignTransaction.mockResolvedValueOnce({ error: 'User declined to sign' } as never)
    const adapter = new FreighterAdapter()
    await expect(adapter.signTransaction('AAAAtx')).rejects.toThrow(
      'Freighter: User declined to sign',
    )
  })

  it('emits account and connection changes and unsubscribes idempotently', () => {
    const adapter = new FreighterAdapter()
    const events: WalletAdapterEvent[] = []
    const unsubscribe = adapter.subscribe((event) => events.push(event))
    const report = (address: string) =>
      watchState.callback?.({
        address,
        network: 'TESTNET',
        networkPassphrase: 'Test SDF Network ; September 2015',
      })

    report(ADDRESS)
    report(`${ADDRESS}2`)
    report('')
    unsubscribe()
    unsubscribe()
    report(ADDRESS)

    expect(events.map((event) => event.type)).toEqual([
      'accountChanged',
      'accountChanged',
      'connectionChanged',
    ])
    expect(events[0]).toEqual({ type: 'accountChanged', publicKey: `${ADDRESS}2` })
    expect(events[2]).toEqual({ type: 'connectionChanged', connected: false })
    expect(watchState.stop).toHaveBeenCalledTimes(1)
  })

  registerWalletAdapterContract((name, test) => it(name, test), {
    createAdapter: () => new FreighterAdapter(),
    publicKey: ADDRESS,
    transactionXdr: 'AAAAtx',
    signedXdr: SIGNED_XDR,
    rejectSigning: () =>
      mockSignTransaction.mockResolvedValueOnce({ error: 'User rejected to sign' } as never),
  })
})
