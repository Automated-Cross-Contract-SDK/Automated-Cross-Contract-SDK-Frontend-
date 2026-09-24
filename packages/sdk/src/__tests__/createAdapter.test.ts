import { describe, it, expect, vi } from 'vitest'
import {
  createAdapter,
  isKnownWallet,
  SUPPORTED_WALLETS,
  type AdapterImporter,
} from '../createAdapter.js'

const noopWalletModule = (exportName: string) => ({
  [exportName]: class {
    opts: unknown
    constructor(opts?: unknown) {
      this.opts = opts
    }
    isConnected = async () => false
    getPublicKey = async () => 'G...' as never
    signTransaction = async (x: string) => x as never
  },
})

describe('createAdapter (#243)', () => {
  it('lists the supported wallets', () => {
    expect(SUPPORTED_WALLETS).toEqual(['freighter', 'albedo', 'lobstr', 'xbull', 'ledger', 'trezor'])
    expect(isKnownWallet('Freighter')).toBe(true)
    expect(isKnownWallet('metamask')).toBe(false)
  })

  it('throws a helpful error listing supported names for an unknown wallet', async () => {
    await expect(createAdapter('metamask')).rejects.toThrow(
      /unknown wallet "metamask".*freighter, albedo, lobstr, xbull, ledger, trezor/s,
    )
  })

  it.each(['freighter', 'albedo', 'lobstr', 'xbull'] as const)(
    'returns a working adapter for "%s" via lazy import',
    async (name) => {
      const exportName = { freighter: 'FreighterAdapter', albedo: 'AlbedoAdapter', lobstr: 'LobstrAdapter', xbull: 'XBullAdapter' }[name]
      const importer: AdapterImporter = vi.fn().mockResolvedValue(noopWalletModule(exportName))

      const adapter = await createAdapter(name, { foo: 1 }, importer)

      expect(importer).toHaveBeenCalledWith(`@soroban-resurrect/adapter-${name}`)
      expect(typeof adapter.isConnected).toBe('function')
      expect(typeof adapter.signTransaction).toBe('function')
      expect((adapter as unknown as { opts: unknown }).opts).toEqual({ foo: 1 })
    },
  )

  it('is case-insensitive on the wallet name', async () => {
    const importer: AdapterImporter = vi.fn().mockResolvedValue(noopWalletModule('FreighterAdapter'))
    const adapter = await createAdapter('FREIGHTER', undefined, importer)
    expect(adapter).toBeDefined()
  })

  it('wraps a failed dynamic import with an actionable message', async () => {
    const importer: AdapterImporter = vi.fn().mockRejectedValue(new Error('Cannot find package'))
    await expect(createAdapter('freighter', undefined, importer)).rejects.toThrow(
      /failed to load "@soroban-resurrect\/adapter-freighter".*npm i @soroban-resurrect\/adapter-freighter/s,
    )
  })

  it('errors when the package is missing the expected export', async () => {
    const importer: AdapterImporter = vi.fn().mockResolvedValue({ SomethingElse: class {} })
    await expect(createAdapter('freighter', undefined, importer)).rejects.toThrow(
      /does not export "FreighterAdapter"/,
    )
  })

  it('creates the ledger hardware adapter from the in-package factory', async () => {
    const adapter = await createAdapter('ledger', { accountIndex: 1 })
    expect((adapter as { type?: string }).type).toBe('ledger')
  })

  it('creates the trezor hardware adapter from the in-package factory', async () => {
    const adapter = await createAdapter('trezor', {
      manifest: { email: 'dev@example.com', appUrl: 'https://example.com' },
    })
    expect((adapter as { type?: string }).type).toBe('trezor')
  })
})
