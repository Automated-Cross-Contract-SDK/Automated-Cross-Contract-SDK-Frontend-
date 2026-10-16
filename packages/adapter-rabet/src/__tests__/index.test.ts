import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RabetAdapter, type RabetApi } from '../index.js'

const connect = vi.fn()
const sign = vi.fn()
const isUnlocked = vi.fn()
const disconnect = vi.fn()

const rabet: RabetApi = { connect, sign, isUnlocked, disconnect }
const PUBLIC_KEY = 'GABC000000000000000000000000000000000000000000000000000RABET'
const SIGNED_XDR = 'AAAAc2lnbmVkLXJldHVybg=='

describe('RabetAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connect.mockResolvedValue({ publicKey: PUBLIC_KEY })
    sign.mockResolvedValue({ xdr: SIGNED_XDR })
    isUnlocked.mockResolvedValue(true)
  })

  it('requests and caches the connected account', async () => {
    const adapter = new RabetAdapter({ rabet })

    expect(await adapter.isConnected()).toBe(true)
    expect(await adapter.getPublicKey()).toBe(PUBLIC_KEY)
    expect(connect).toHaveBeenCalledOnce()
  })

  it('reports disconnected state and clears the cached account when locked', async () => {
    const adapter = new RabetAdapter({ rabet })
    await adapter.getPublicKey()

    isUnlocked.mockResolvedValueOnce(false)
    expect(await adapter.isConnected()).toBe(false)
  })

  it('disconnects the wallet and clears local connection state', async () => {
    const adapter = new RabetAdapter({ rabet })
    await adapter.getPublicKey()

    await adapter.disconnect()

    expect(disconnect).toHaveBeenCalledOnce()
    expect(await adapter.isConnected()).toBe(false)
  })

  it('maps account connection rejection to a structured wallet error', async () => {
    connect.mockRejectedValueOnce(new Error('User rejected connection'))
    const adapter = new RabetAdapter({ rabet })

    await expect(adapter.getPublicKey()).rejects.toMatchObject({
      code: 'USER_REJECTED',
      message: 'Rabet: User rejected connection',
    })
  })

  it('maps network options to Rabet identifiers', async () => {
    const adapter = new RabetAdapter({ rabet })

    await adapter.signTransaction('unsigned-xdr', { network: 'public' })
    expect(sign).toHaveBeenCalledWith('unsigned-xdr', 'mainnet')

    await adapter.signTransaction('unsigned-xdr', {
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
    expect(sign).toHaveBeenLastCalledWith('unsigned-xdr', 'testnet')
  })

  it('rejects unsupported network options before invoking Rabet', async () => {
    const adapter = new RabetAdapter({ rabet })

    await expect(
      adapter.signTransaction('unsigned-xdr', { networkPassphrase: 'Private Stellar Network' }),
    ).rejects.toMatchObject({ code: 'NETWORK_MISMATCH' })
    await expect(
      adapter.signTransaction('unsigned-xdr', {
        network: 'testnet',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_MISMATCH' })
    expect(sign).not.toHaveBeenCalled()
  })

  it('reports missing signing output and unsupported auth-entry signing', async () => {
    sign.mockResolvedValueOnce({ xdr: '' })
    const adapter = new RabetAdapter({ rabet })

    await expect(adapter.signTransaction('unsigned-xdr')).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'Rabet: wallet returned no signed transaction XDR',
    })
    expect(adapter.capabilities.signAuthEntry).toBe(false)
  })
})
