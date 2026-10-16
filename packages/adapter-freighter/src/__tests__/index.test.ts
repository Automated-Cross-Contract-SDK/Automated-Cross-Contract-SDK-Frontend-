import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
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
const TEST_ACCOUNT = Keypair.random()
const SIGNED_XDR = new TransactionBuilder(new Account(TEST_ACCOUNT.publicKey(), '0'), {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.payment({
      destination: TEST_ACCOUNT.publicKey(),
      asset: Asset.native(),
      amount: '1',
    }),
  )
  .setTimeout(30)
  .build()
  .toXDR()

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

  it('maps rejected connection checks to structured wallet errors', async () => {
    mockIsConnected.mockRejectedValueOnce(new Error('Freighter is unavailable'))
    const adapter = new FreighterAdapter()
    await expect(adapter.isConnected()).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
      message: 'Freighter: Freighter is unavailable',
    })
  })

  it('getPublicKey returns the granted address', async () => {
    const adapter = new FreighterAdapter()
    expect(await adapter.getPublicKey()).toBe(ADDRESS)
    expect(mockRequestAccess).toHaveBeenCalledTimes(1)
  })

  it('getPublicKey throws when access is denied', async () => {
    mockRequestAccess.mockResolvedValueOnce({ error: 'User declined access' } as never)
    const adapter = new FreighterAdapter()
    await expect(adapter.getPublicKey()).rejects.toMatchObject({
      code: 'USER_REJECTED',
      message: 'Freighter: User declined access',
    })
  })

  it('maps connection errors to structured wallet errors', async () => {
    mockRequestAccess.mockResolvedValueOnce({ error: 'Freighter is not installed' } as never)
    const adapter = new FreighterAdapter()
    await expect(adapter.getPublicKey()).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
      message: 'Freighter: Freighter is not installed',
    })
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
    await expect(adapter.signTransaction('AAAAtx')).rejects.toMatchObject({
      code: 'USER_REJECTED',
      message: 'Freighter: User declined to sign',
    })
  })

  it('rejects signing results that are not valid transaction envelope XDR', async () => {
    mockSignTransaction.mockResolvedValueOnce({ signedTxXdr: 'not-xdr' } as never)
    const adapter = new FreighterAdapter()
    await expect(adapter.signTransaction('AAAAtx')).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'Freighter: wallet returned invalid signed transaction XDR',
    })
  })
})
