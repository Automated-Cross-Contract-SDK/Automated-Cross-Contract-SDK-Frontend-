import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerWalletAdapterContract } from '../../../testing/src/index.js'
import { RabetAdapter, type RabetApi } from '../index.js'

vi.mock('@soroban-resurrect/sdk', async () => import('../../../testing/src/sdkTestModule.js'))

const PUBLIC_KEY = 'GABC0000000000000000000000000000000000000000000000000RABET'
const SIGNED_XDR = 'AAAArabet-signed'
const NETWORK = 'Test SDF Network ; September 2015'

describe('RabetAdapter', () => {
  let api: RabetApi
  let sign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sign = vi.fn().mockResolvedValue({ xdr: SIGNED_XDR })
    api = {
      connect: vi.fn().mockResolvedValue({ publicKey: PUBLIC_KEY }),
      sign,
      isUnlocked: vi.fn().mockResolvedValue(true),
    }
  })

  it('refreshes the selected account on each public-key request', async () => {
    const connect = vi
      .fn()
      .mockResolvedValueOnce({ publicKey: PUBLIC_KEY })
      .mockResolvedValueOnce({ publicKey: `${PUBLIC_KEY}2` })
    const adapter = new RabetAdapter({ rabet: { ...api, connect } })

    expect(await adapter.getPublicKey()).toBe(PUBLIC_KEY)
    expect(await adapter.getPublicKey()).toBe(`${PUBLIC_KEY}2`)
  })

  it('maps user rejection to WalletError', async () => {
    sign.mockRejectedValueOnce(new Error('User rejected'))
    const adapter = new RabetAdapter({ rabet: api })

    await expect(adapter.signTransaction('AAAA')).rejects.toMatchObject({
      code: 'USER_REJECTED',
    })
  })

  registerWalletAdapterContract((name, test) => it(name, test), {
    createAdapter: () => new RabetAdapter({ rabet: api }),
    publicKey: PUBLIC_KEY,
    transactionXdr: 'AAAA',
    signedXdr: SIGNED_XDR,
    rejectSigning: () => sign.mockRejectedValueOnce(new Error('User rejected')),
  })
})
