import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import {
  isConnected as lobstrIsConnected,
  getPublicKey as lobstrGetPublicKey,
  signTransaction as lobstrSignTransaction,
} from '@lobstrco/signer-extension-api'
import { LobstrAdapter } from '../index.js'

vi.mock('@lobstrco/signer-extension-api', () => ({
  isConnected: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
}))

const mockIsConnected = vi.mocked(lobstrIsConnected)
const mockGetPublicKey = vi.mocked(lobstrGetPublicKey)
const mockSignTransaction = vi.mocked(lobstrSignTransaction)

const PUBKEY = 'GABC0000000000000000000000000000000000000000000000000LOBSTR'
const SIGNED_XDR = 'AAAAlobstr++signed//xdr=='

describe('LobstrAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockResolvedValue(true)
    mockGetPublicKey.mockResolvedValue(PUBKEY)
    mockSignTransaction.mockResolvedValue(SIGNED_XDR)
  })

  it('satisfies the WalletAdapter contract', () => {
    const adapter: WalletAdapter = new LobstrAdapter()
    expect(typeof adapter.isConnected).toBe('function')
    expect(typeof adapter.getPublicKey).toBe('function')
    expect(typeof adapter.signTransaction).toBe('function')
  })

  it('isConnected passes through the extension API result', async () => {
    const adapter = new LobstrAdapter()
    expect(await adapter.isConnected()).toBe(true)

    mockIsConnected.mockResolvedValueOnce(false)
    expect(await adapter.isConnected()).toBe(false)
  })

  it('getPublicKey passes through the extension API result', async () => {
    const adapter = new LobstrAdapter()
    expect(await adapter.getPublicKey()).toBe(PUBKEY)
    expect(mockGetPublicKey).toHaveBeenCalledTimes(1)
  })

  it('getPublicKey propagates errors', async () => {
    mockGetPublicKey.mockRejectedValueOnce(new Error('not connected'))
    const adapter = new LobstrAdapter()
    await expect(adapter.getPublicKey()).rejects.toThrow('not connected')
  })

  it('signTransaction returns base64 XDR and calls the API with a single argument', async () => {
    const adapter = new LobstrAdapter()
    const result = await adapter.signTransaction('AAAAtx', {
      networkPassphrase: 'Test SDF Network ; September 2015',
    })

    expect(result).toBe(SIGNED_XDR)
    expect(mockSignTransaction).toHaveBeenCalledTimes(1)
    expect(mockSignTransaction).toHaveBeenCalledWith('AAAAtx')
    expect(mockSignTransaction.mock.calls[0]).toHaveLength(1)
  })

  it('signTransaction propagates rejection from the wallet', async () => {
    mockSignTransaction.mockRejectedValueOnce(new Error('User declined'))
    const adapter = new LobstrAdapter()
    await expect(adapter.signTransaction('AAAAtx')).rejects.toThrow('User declined')
  })
})
