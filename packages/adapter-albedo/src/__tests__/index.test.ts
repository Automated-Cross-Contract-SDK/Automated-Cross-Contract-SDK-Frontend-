import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import albedo from '@albedo-link/intent'
import { AlbedoAdapter } from '../index.js'

vi.mock('@albedo-link/intent', () => ({
  default: {
    publicKey: vi.fn(),
    tx: vi.fn(),
  },
}))

const mockPublicKey = vi.mocked(albedo.publicKey)
const mockTx = vi.mocked(albedo.tx)

const PUBKEY = 'GABC0000000000000000000000000000000000000000000000000ALBEDO'
const SIGNED_XDR = 'AAAAalbedo++signed//xdr=='

describe('AlbedoAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPublicKey.mockResolvedValue({ pubkey: PUBKEY } as never)
    mockTx.mockResolvedValue({ signed_envelope_xdr: SIGNED_XDR } as never)
  })

  it('satisfies the WalletAdapter contract', () => {
    const adapter: WalletAdapter = new AlbedoAdapter()
    expect(typeof adapter.isConnected).toBe('function')
    expect(typeof adapter.getPublicKey).toBe('function')
    expect(typeof adapter.signTransaction).toBe('function')
  })

  it('reports not connected until getPublicKey resolves', async () => {
    const adapter = new AlbedoAdapter()
    expect(await adapter.isConnected()).toBe(false)
    await adapter.getPublicKey()
    expect(await adapter.isConnected()).toBe(true)
  })

  it('getPublicKey returns the selected pubkey', async () => {
    const adapter = new AlbedoAdapter()
    expect(await adapter.getPublicKey()).toBe(PUBKEY)
  })

  it('signTransaction returns base64 XDR from signed_envelope_xdr', async () => {
    const adapter = new AlbedoAdapter()
    expect(await adapter.signTransaction('AAAAtx')).toBe(SIGNED_XDR)
  })

  it('maps to the "testnet" network identifier by default (not a passphrase)', async () => {
    const adapter = new AlbedoAdapter()
    await adapter.signTransaction('AAAAtx')

    expect(mockTx).toHaveBeenCalledWith(
      expect.objectContaining({ xdr: 'AAAAtx', network: 'testnet', submit: false }),
    )
  })

  it('forwards an explicit network identifier to Albedo', async () => {
    const adapter = new AlbedoAdapter()
    await adapter.signTransaction('AAAAtx', {
      network: 'public',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    })

    expect(mockTx).toHaveBeenCalledWith(expect.objectContaining({ network: 'public' }))
  })

  it('propagates rejection from the Albedo intent', async () => {
    mockTx.mockRejectedValueOnce(new Error('User rejected'))
    const adapter = new AlbedoAdapter()
    await expect(adapter.signTransaction('AAAAtx')).rejects.toThrow('User rejected')
  })
})
