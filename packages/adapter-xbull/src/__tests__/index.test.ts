import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import { XBullAdapter } from '../index.js'

const mockConnect = vi.fn()
const mockSign = vi.fn()

vi.mock('@creit.tech/xbull-wallet-connect', () => ({
  XBullWalletConnect: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    sign: mockSign,
  })),
}))

const PUBKEY = 'GABC000000000000000000000000000000000000000000000000000XBULL'
const SIGNED_XDR = 'AAAAxbull++signed//xdr=='

describe('XBullAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(PUBKEY)
    mockSign.mockResolvedValue(SIGNED_XDR)
  })

  it('satisfies the WalletAdapter contract', () => {
    const adapter: WalletAdapter = new XBullAdapter()
    expect(typeof adapter.isConnected).toBe('function')
    expect(typeof adapter.getPublicKey).toBe('function')
    expect(typeof adapter.signTransaction).toBe('function')
  })

  it('reports not connected until getPublicKey resolves', async () => {
    const adapter = new XBullAdapter()
    expect(await adapter.isConnected()).toBe(false)
    await adapter.getPublicKey()
    expect(await adapter.isConnected()).toBe(true)
  })

  it('getPublicKey connects and returns the wallet public key', async () => {
    const adapter = new XBullAdapter()
    expect(await adapter.getPublicKey()).toBe(PUBKEY)
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('propagates errors from the underlying connect() call', async () => {
    mockConnect.mockRejectedValueOnce(new Error('user rejected connection'))
    const adapter = new XBullAdapter()
    await expect(adapter.getPublicKey()).rejects.toThrow('user rejected connection')
  })

  it('signTransaction throws when the wallet is not connected', async () => {
    const adapter = new XBullAdapter()
    await expect(adapter.signTransaction('AAAA')).rejects.toThrow('xBull: wallet is not connected')
  })

  it('signTransaction returns base64 XDR and forwards the network passphrase', async () => {
    const adapter = new XBullAdapter()
    await adapter.getPublicKey()

    const result = await adapter.signTransaction('AAAAtx', {
      networkPassphrase: 'Test SDF Network ; September 2015',
    })

    expect(result).toBe(SIGNED_XDR)
    expect(mockSign).toHaveBeenCalledWith({
      xdr: 'AAAAtx',
      publicKey: PUBKEY,
      network: 'Test SDF Network ; September 2015',
    })
  })

  it('signTransaction propagates rejection from the wallet', async () => {
    mockSign.mockRejectedValueOnce(new Error('user declined'))
    const adapter = new XBullAdapter()
    await adapter.getPublicKey()
    await expect(adapter.signTransaction('AAAAtx')).rejects.toThrow('user declined')
  })
})
