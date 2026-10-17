import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import {
  isConnected as freighterIsConnected,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction as freighterSignTransaction,
  signAuthEntry as freighterSignAuthEntry,
} from '@stellar/freighter-api'
import { FreighterAdapter } from '../index.js'

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
  signAuthEntry: vi.fn(),
}))

const mockIsConnected = vi.mocked(freighterIsConnected)
const mockRequestAccess = vi.mocked(requestAccess)
const mockGetAddress = vi.mocked(getAddress)
const mockGetNetwork = vi.mocked(getNetwork)
const mockSignTransaction = vi.mocked(freighterSignTransaction)
const mockSignAuthEntry = vi.mocked(freighterSignAuthEntry)

const ADDRESS = 'GABC00000000000000000000000000000000000000000000000FREIGHTER'
const SIGNED_XDR = 'AAAAfreighter++signed//xdr=='
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'

describe('FreighterAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({ address: ADDRESS })
    mockGetAddress.mockResolvedValue({ address: ADDRESS })
    mockGetNetwork.mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: TESTNET_PASSPHRASE,
    })
    mockSignTransaction.mockResolvedValue({ signedTxXdr: SIGNED_XDR, signerAddress: ADDRESS })
    mockSignAuthEntry.mockResolvedValue({
      signedAuthEntry: Buffer.from('signed-auth-entry'),
      signerAddress: ADDRESS,
    })
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
    mockRequestAccess.mockResolvedValueOnce({
      error: { code: 400, message: 'User declined access' },
    } as never)
    const adapter = new FreighterAdapter()
    await expect(adapter.getPublicKey()).rejects.toMatchObject({
      code: 'USER_REJECTED',
      message: 'Freighter: User declined access',
    })
  })

  it('getNetwork returns the active network passphrase', async () => {
    const adapter = new FreighterAdapter()
    await expect(adapter.getNetwork()).resolves.toBe(TESTNET_PASSPHRASE)
  })

  it('signTransaction returns base64 XDR and forwards passphrase + address', async () => {
    const adapter = new FreighterAdapter()
    const result = await adapter.signTransaction('AAAAtx', {
      networkPassphrase: TESTNET_PASSPHRASE,
    })

    expect(result).toBe(SIGNED_XDR)
    expect(mockGetNetwork).toHaveBeenCalledTimes(1)
    expect(mockSignTransaction).toHaveBeenCalledWith('AAAAtx', {
      networkPassphrase: TESTNET_PASSPHRASE,
      address: ADDRESS,
    })
  })

  it('uses the active Freighter network when the network label is supplied', async () => {
    const publicPassphrase = 'Public Global Stellar Network ; September 2015'
    mockGetNetwork.mockResolvedValueOnce({
      network: 'PUBLIC',
      networkPassphrase: publicPassphrase,
    })
    const adapter = new FreighterAdapter()
    await adapter.signTransaction('AAAAtx', { network: 'mainnet' })

    expect(mockSignTransaction).toHaveBeenCalledWith('AAAAtx', {
      networkPassphrase: publicPassphrase,
      address: ADDRESS,
    })
  })

  it('rejects signing before wallet invocation when Freighter has the wrong network', async () => {
    const adapter = new FreighterAdapter()

    await expect(
      adapter.signTransaction('AAAAtx', { networkPassphrase: 'Public Global Stellar Network' }),
    ).rejects.toMatchObject({ code: 'NETWORK_MISMATCH' })
    expect(mockSignTransaction).not.toHaveBeenCalled()
  })

  it('signTransaction throws when the wallet rejects signing', async () => {
    mockSignTransaction.mockResolvedValueOnce({
      error: { code: 400, message: 'User declined to sign' },
    } as never)
    const adapter = new FreighterAdapter()
    await expect(adapter.signTransaction('AAAAtx')).rejects.toMatchObject({
      code: 'USER_REJECTED',
      message: 'Freighter: User declined to sign',
    })
  })

  it('normalizes rejected signing promises as user rejection', async () => {
    mockSignTransaction.mockRejectedValueOnce({
      code: 400,
      message: 'User rejected request',
    })
    const adapter = new FreighterAdapter()
    await expect(adapter.signTransaction('AAAAtx')).rejects.toMatchObject({
      code: 'USER_REJECTED',
    })
  })

  it('signAuthEntry forwards the passphrase and returns base64', async () => {
    const adapter = new FreighterAdapter()
    const result = await adapter.signAuthEntry('AAAAuth', {
      networkPassphrase: TESTNET_PASSPHRASE,
      address: ADDRESS,
    })

    expect(result).toBe(Buffer.from('signed-auth-entry').toString('base64'))
    expect(mockSignAuthEntry).toHaveBeenCalledWith('AAAAuth', {
      networkPassphrase: TESTNET_PASSPHRASE,
      address: ADDRESS,
    })
  })

  it('normalizes signAuthEntry user rejection', async () => {
    mockSignAuthEntry.mockResolvedValueOnce({
      error: { code: 400, message: 'User declined to sign' },
    } as never)
    const adapter = new FreighterAdapter()

    await expect(adapter.signAuthEntry('AAAAuth')).rejects.toMatchObject({
      code: 'USER_REJECTED',
    })
  })
})
