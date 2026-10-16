import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerWalletAdapterContract } from '../../../testing/src/index.js'
import { WalletKitAdapter, type StellarWalletsKitLike } from '../index.js'

vi.mock('@soroban-resurrect/sdk', async () => import('../../../testing/src/sdkTestModule.js'))

const PUBLIC_KEY = 'GABC0000000000000000000000000000000000000000000000000WALLETKIT'
const SIGNED_XDR = 'AAAAwalletkit-signed'

describe('WalletKitAdapter', () => {
  let kit: StellarWalletsKitLike
  let signTransaction: ReturnType<typeof vi.fn>

  beforeEach(() => {
    signTransaction = vi.fn().mockResolvedValue({ signedTxXdr: SIGNED_XDR })
    kit = {
      getAddress: vi.fn().mockResolvedValue({ address: PUBLIC_KEY }),
      signTransaction,
    }
  })

  it('reads the selected account from the current kit state', async () => {
    const getAddress = vi
      .fn()
      .mockResolvedValueOnce({ address: PUBLIC_KEY })
      .mockResolvedValueOnce({ address: `${PUBLIC_KEY}2` })
    const adapter = new WalletKitAdapter({ kit: { ...kit, getAddress } })

    expect(await adapter.getPublicKey()).toBe(PUBLIC_KEY)
    expect(await adapter.getPublicKey()).toBe(`${PUBLIC_KEY}2`)
  })

  it('maps signing cancellation to WalletError', async () => {
    signTransaction.mockRejectedValueOnce(new Error('User declined'))
    const adapter = new WalletKitAdapter({ kit })

    await expect(adapter.signTransaction('AAAA')).rejects.toMatchObject({
      code: 'USER_REJECTED',
    })
  })

  registerWalletAdapterContract((name, test) => it(name, test), {
    createAdapter: () => new WalletKitAdapter({ kit }),
    publicKey: PUBLIC_KEY,
    transactionXdr: 'AAAA',
    signedXdr: SIGNED_XDR,
    rejectSigning: () => signTransaction.mockRejectedValueOnce(new Error('User rejected')),
  })
})
