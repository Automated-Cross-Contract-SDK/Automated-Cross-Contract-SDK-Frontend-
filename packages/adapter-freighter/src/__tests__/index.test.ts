import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import {
  isConnected as freighterIsConnected,
  requestAccess,
  getAddress,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api'
import { FreighterAdapter } from '../index.js'

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  signTransaction: vi.fn(),
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
    expect(mockRequestAccess).toHaveBeenCalledTimes(1)
  })

  it('getPublicKey throws when access is denied', async () => {
    mockRequestAccess.mockResolvedValueOnce({ error: 'User declined access' } as never)
    const adapter = new FreighterAdapter()
    await expect(adapter.getPublicKey()).rejects.toThrow('Freighter: User declined access')
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
})
