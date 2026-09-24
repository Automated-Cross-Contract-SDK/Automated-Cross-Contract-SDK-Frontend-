import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Networks, Keypair, TransactionBuilder, Account, Operation, Transaction } from '@stellar/stellar-sdk'
import {
  LedgerWalletAdapter,
  TrezorWalletAdapter,
  createLedgerAdapter,
  createTrezorAdapter,
} from '../HardwareWalletAdapters.js'
import type { LedgerAdapterConfig, TrezorAdapterConfig } from '../types.js'

// ---------------------------------------------------------------------------
// Module-level mocks for optional peer dependencies
// vi.mock() is hoisted by Vitest to the top of the file, so these intercept
// the dynamic import() calls inside HardwareWalletAdapters.ts at runtime.
// ---------------------------------------------------------------------------

// Placeholder — replaced per-test via mockStrAppFactory below.
let _mockStrAppInstance: ReturnType<typeof buildStrAppMock> | null = null

vi.mock('@ledgerhq/hw-app-str', () => ({
  default: vi.fn().mockImplementation(() => _mockStrAppInstance),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSampleTxXdr(networkPassphrase = Networks.TESTNET): string {
  const kp = Keypair.random()
  const account = new Account(kp.publicKey(), '1')
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
  return tx.toEnvelope().toXDR('base64')
}

/** Creates a minimal Ledger transport mock. */
function makeMockTransport() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * Builds a mock @ledgerhq/hw-app-str Str instance.
 * `signHash` produces a real Ed25519 signature so `addSignature` passes validation.
 */
function buildStrAppMock(kp: Keypair) {
  return {
    getPublicKey: vi.fn().mockResolvedValue({ publicKey: kp.publicKey() }),
    getAppConfiguration: vi.fn().mockResolvedValue({ version: '6.1.0' }),
    signHash: vi.fn().mockImplementation(async (_path: string, hash: Uint8Array) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signature: (kp as any).sign(hash),
    })),
  }
}

/**
 * Builds a minimal TrezorConnect mock.
 * `stellarSignTransaction` produces a real Ed25519 signature so `addSignature` passes.
 */
function buildTrezorConnectMock(kp: Keypair) {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    getFeatures: vi.fn().mockResolvedValue({
      success: true,
      payload: { major_version: 2, minor_version: 7, patch_version: 1 },
    }),
    stellarGetAddress: vi.fn().mockResolvedValue({
      success: true,
      payload: { address: kp.publicKey() },
    }),
    stellarSignTransaction: vi
      .fn()
      .mockImplementation(
        async (opts: { transaction: { envelopeXdr: string }; networkPassphrase: string }) => {
          const { TransactionBuilder } = await import('@stellar/stellar-sdk')
          const tx = TransactionBuilder.fromXDR(
            opts.transaction.envelopeXdr,
            opts.networkPassphrase,
          ) as Transaction
          const hash = tx.hash()
          const sig = kp.sign(hash)
          const signatureBase64 = Buffer.from(sig).toString('base64')
          return {
            success: true,
            payload: { signature: signatureBase64, publicKey: kp.publicKey() },
          }
        },
      ),
  }
}

// ---------------------------------------------------------------------------
// LedgerWalletAdapter
// ---------------------------------------------------------------------------

describe('LedgerWalletAdapter', () => {
  let transport: ReturnType<typeof makeMockTransport>
  let strApp: ReturnType<typeof buildStrAppMock>
  let kp: Keypair
  let config: LedgerAdapterConfig

  beforeEach(() => {
    vi.clearAllMocks()
    kp = Keypair.random()
    transport = makeMockTransport()
    strApp = buildStrAppMock(kp)
    // Point the module-level hoisted mock at this test's strApp instance.
    _mockStrAppInstance = strApp
    config = { transport, accountIndex: 0 }
  })

  describe('constructor', () => {
    it('has type "ledger"', () => {
      const adapter = new LedgerWalletAdapter(config)
      expect(adapter.type).toBe('ledger')
    })

    it('defaults accountIndex to 0', () => {
      const adapter = new LedgerWalletAdapter()
      expect(adapter.type).toBe('ledger')
    })

    it('accepts a custom accountIndex', () => {
      const adapter = new LedgerWalletAdapter({ accountIndex: 3 })
      expect(adapter.type).toBe('ledger')
    })
  })

  describe('connect()', () => {
    it('throws when no transport is provided', async () => {
      const adapter = new LedgerWalletAdapter({ accountIndex: 0 })
      await expect(adapter.connect()).rejects.toThrow(
        'LedgerWalletAdapter: no transport provided',
      )
    })

    it('marks the adapter as connected after successful connect()', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      expect(await adapter.isConnected()).toBe(true)
    })

    it('pre-fetches and caches the public key on connect()', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      expect(strApp.getPublicKey).toHaveBeenCalledTimes(1)
    })
  })

  describe('disconnect()', () => {
    it('marks the adapter as disconnected', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      await adapter.disconnect()
      expect(await adapter.isConnected()).toBe(false)
    })

    it('calls close() on the transport', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      await adapter.disconnect()
      expect(transport.close).toHaveBeenCalledTimes(1)
    })
  })

  describe('isConnected()', () => {
    it('returns false before connect()', async () => {
      const adapter = new LedgerWalletAdapter(config)
      expect(await adapter.isConnected()).toBe(false)
    })

    it('returns true after connect()', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      expect(await adapter.isConnected()).toBe(true)
    })
  })

  describe('getPublicKey()', () => {
    it('throws when not connected', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await expect(adapter.getPublicKey()).rejects.toThrow(
        'LedgerWalletAdapter: not connected',
      )
    })

    it('returns the public key after connect()', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      const pk = await adapter.getPublicKey()
      expect(pk).toBe(kp.publicKey())
    })

    it('returns the cached key without calling the device a second time', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      await adapter.getPublicKey()
      await adapter.getPublicKey()
      // getPublicKey on the hw-app-str called exactly once (during connect)
      expect(strApp.getPublicKey).toHaveBeenCalledTimes(1)
    })
  })

  describe('getAppVersion()', () => {
    it('throws when not connected', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await expect(adapter.getAppVersion()).rejects.toThrow(
        'LedgerWalletAdapter: not connected',
      )
    })

    it('returns the Stellar app version string', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      const version = await adapter.getAppVersion()
      expect(version).toBe('6.1.0')
    })
  })

  describe('signTransaction()', () => {
    it('throws when not connected', async () => {
      const adapter = new LedgerWalletAdapter(config)
      const txXdr = makeSampleTxXdr()
      await expect(adapter.signTransaction(txXdr)).rejects.toThrow(
        'LedgerWalletAdapter: not connected',
      )
    })

    it('calls signHash on the Stellar app with the transaction hash', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      await adapter.signTransaction(txXdr, { networkPassphrase: Networks.TESTNET })
      expect(strApp.signHash).toHaveBeenCalledTimes(1)
      const [path, hash] = strApp.signHash.mock.calls[0]
      expect(path).toBe("m/44'/148'/0'")
      expect(hash).toBeInstanceOf(Uint8Array)
    })

    it('returns a base64 XDR string', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      const signed = await adapter.signTransaction(txXdr, {
        networkPassphrase: Networks.TESTNET,
      })
      expect(typeof signed).toBe('string')
      expect(signed.length).toBeGreaterThan(0)
    })

    it('uses custom accountIndex in the BIP44 path', async () => {
      const adapter = new LedgerWalletAdapter({ transport, accountIndex: 5 })
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      await adapter.signTransaction(txXdr, { networkPassphrase: Networks.TESTNET })
      const [path] = strApp.signHash.mock.calls[0]
      expect(path).toBe("m/44'/148'/5'")
    })

    it('defaults to TESTNET passphrase when opts are omitted', async () => {
      const adapter = new LedgerWalletAdapter(config)
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      const signed = await adapter.signTransaction(txXdr)
      expect(typeof signed).toBe('string')
    })
  })
})

// ---------------------------------------------------------------------------
// TrezorWalletAdapter
// ---------------------------------------------------------------------------

describe('TrezorWalletAdapter', () => {
  let trezorConnect: ReturnType<typeof buildTrezorConnectMock>
  let kp: Keypair
  let config: TrezorAdapterConfig

  beforeEach(() => {
    vi.clearAllMocks()
    kp = Keypair.random()
    trezorConnect = buildTrezorConnectMock(kp)
    config = {
      trezorConnect,
      manifest: { email: 'test@example.com', appUrl: 'https://test.example.com' },
      accountIndex: 0,
    }
  })

  describe('constructor', () => {
    it('has type "trezor"', () => {
      const adapter = new TrezorWalletAdapter(config)
      expect(adapter.type).toBe('trezor')
    })

    it('defaults accountIndex to 0', () => {
      const adapter = new TrezorWalletAdapter({
        trezorConnect,
        manifest: { email: 'a@b.com', appUrl: 'https://a.com' },
      })
      expect(adapter.type).toBe('trezor')
    })
  })

  describe('connect()', () => {
    it('throws when no trezorConnect instance is provided', async () => {
      const adapter = new TrezorWalletAdapter({
        trezorConnect: null,
        manifest: { email: 'a@b.com', appUrl: 'https://a.com' },
      })
      await expect(adapter.connect()).rejects.toThrow(
        'TrezorWalletAdapter: no TrezorConnect instance provided',
      )
    })

    it('calls trezorConnect.init() with the manifest', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      expect(trezorConnect.init).toHaveBeenCalledWith({
        lazyLoad: true,
        manifest: config.manifest,
      })
    })

    it('marks the adapter as connected after successful connect()', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      expect(await adapter.isConnected()).toBe(true)
    })

    it('pre-fetches and caches the public key on connect()', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      expect(trezorConnect.stellarGetAddress).toHaveBeenCalledTimes(1)
    })

    it('throws when stellarGetAddress fails during connect', async () => {
      trezorConnect.stellarGetAddress = vi.fn().mockResolvedValue({
        success: false,
        payload: { error: 'device not ready' },
      })
      const adapter = new TrezorWalletAdapter(config)
      await expect(adapter.connect()).rejects.toThrow(
        'TrezorWalletAdapter: getAddress failed — device not ready',
      )
    })
  })

  describe('disconnect()', () => {
    it('marks the adapter as disconnected', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      await adapter.disconnect()
      expect(await adapter.isConnected()).toBe(false)
    })
  })

  describe('isConnected()', () => {
    it('returns false before connect()', async () => {
      const adapter = new TrezorWalletAdapter(config)
      expect(await adapter.isConnected()).toBe(false)
    })

    it('returns true after connect()', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      expect(await adapter.isConnected()).toBe(true)
    })
  })

  describe('getPublicKey()', () => {
    it('throws when not connected', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await expect(adapter.getPublicKey()).rejects.toThrow(
        'TrezorWalletAdapter: not connected',
      )
    })

    it('returns the Stellar address after connect()', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      const pk = await adapter.getPublicKey()
      expect(pk).toBe(kp.publicKey())
    })

    it('returns the cached key without calling the device again', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      await adapter.getPublicKey()
      await adapter.getPublicKey()
      // stellarGetAddress called once during connect; no extra calls
      expect(trezorConnect.stellarGetAddress).toHaveBeenCalledTimes(1)
    })
  })

  describe('getAppVersion()', () => {
    it('throws when not connected', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await expect(adapter.getAppVersion()).rejects.toThrow(
        'TrezorWalletAdapter: not connected',
      )
    })

    it('returns a version string derived from firmware features', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      const version = await adapter.getAppVersion()
      expect(version).toBe('2.7.1')
    })

    it('throws when getFeatures fails', async () => {
      trezorConnect.getFeatures = vi.fn().mockResolvedValue({
        success: false,
        payload: { error: 'PIN required' },
      })
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      await expect(adapter.getAppVersion()).rejects.toThrow(
        'TrezorWalletAdapter: getFeatures failed — PIN required',
      )
    })
  })

  describe('signTransaction()', () => {
    it('throws when not connected', async () => {
      const adapter = new TrezorWalletAdapter(config)
      const txXdr = makeSampleTxXdr()
      await expect(adapter.signTransaction(txXdr)).rejects.toThrow(
        'TrezorWalletAdapter: not connected',
      )
    })

    it('calls stellarSignTransaction with the correct path and passphrase', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      await adapter.signTransaction(txXdr, { networkPassphrase: Networks.TESTNET })

      expect(trezorConnect.stellarSignTransaction).toHaveBeenCalledTimes(1)
      const [callArgs] = trezorConnect.stellarSignTransaction.mock.calls
      expect(callArgs[0].path).toBe("m/44'/148'/0'/0/0")
      expect(callArgs[0].networkPassphrase).toBe(Networks.TESTNET)
    })

    it('returns a base64 XDR string', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      const signed = await adapter.signTransaction(txXdr, {
        networkPassphrase: Networks.TESTNET,
      })
      expect(typeof signed).toBe('string')
      expect(signed.length).toBeGreaterThan(0)
    })

    it('throws when stellarSignTransaction fails', async () => {
      trezorConnect.stellarSignTransaction = vi.fn().mockResolvedValue({
        success: false,
        payload: { error: 'user cancelled' },
      })
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      await expect(
        adapter.signTransaction(txXdr, { networkPassphrase: Networks.TESTNET }),
      ).rejects.toThrow('TrezorWalletAdapter: signing failed — user cancelled')
    })

    it('uses custom accountIndex in the BIP44 path', async () => {
      const adapter = new TrezorWalletAdapter({ ...config, accountIndex: 2 })
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      await adapter.signTransaction(txXdr, { networkPassphrase: Networks.TESTNET })
      const [callArgs] = trezorConnect.stellarSignTransaction.mock.calls
      expect(callArgs[0].path).toBe("m/44'/148'/2'/0/0")
    })

    it('defaults to TESTNET passphrase when opts are omitted', async () => {
      const adapter = new TrezorWalletAdapter(config)
      await adapter.connect()
      const txXdr = makeSampleTxXdr()
      const signed = await adapter.signTransaction(txXdr)
      expect(typeof signed).toBe('string')
    })
  })
})

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

describe('createLedgerAdapter', () => {
  it('returns a LedgerWalletAdapter instance', () => {
    const adapter = createLedgerAdapter()
    expect(adapter).toBeInstanceOf(LedgerWalletAdapter)
  })

  it('passes config to the adapter', () => {
    const transport = makeMockTransport()
    const adapter = createLedgerAdapter({ transport, accountIndex: 2 })
    expect(adapter).toBeInstanceOf(LedgerWalletAdapter)
    expect(adapter.type).toBe('ledger')
  })

  it('works with an empty config', () => {
    const adapter = createLedgerAdapter({})
    expect(adapter.type).toBe('ledger')
  })

  it('returns a new instance on each call', () => {
    const a = createLedgerAdapter()
    const b = createLedgerAdapter()
    expect(a).not.toBe(b)
  })
})

describe('createTrezorAdapter', () => {
  it('returns a TrezorWalletAdapter instance', () => {
    const tc = buildTrezorConnectMock(Keypair.random())
    const adapter = createTrezorAdapter({
      trezorConnect: tc,
      manifest: { email: 'a@b.com', appUrl: 'https://a.com' },
    })
    expect(adapter).toBeInstanceOf(TrezorWalletAdapter)
  })

  it('passes config to the adapter', () => {
    const tc = buildTrezorConnectMock(Keypair.random())
    const adapter = createTrezorAdapter({
      trezorConnect: tc,
      manifest: { email: 'dev@test.com', appUrl: 'https://dev.test.com' },
      accountIndex: 1,
    })
    expect(adapter.type).toBe('trezor')
  })

  it('returns a new instance on each call', () => {
    const tc = buildTrezorConnectMock(Keypair.random())
    const cfg: TrezorAdapterConfig = {
      trezorConnect: tc,
      manifest: { email: 'a@b.com', appUrl: 'https://a.com' },
    }
    const a = createTrezorAdapter(cfg)
    const b = createTrezorAdapter(cfg)
    expect(a).not.toBe(b)
  })
})
