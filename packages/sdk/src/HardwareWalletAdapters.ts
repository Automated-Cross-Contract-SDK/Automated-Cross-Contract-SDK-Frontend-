import { Networks } from '@stellar/stellar-sdk'
import type { HardwareWalletAdapter, LedgerAdapterConfig, TrezorAdapterConfig } from './types.js'

/**
 * BIP44 coin type for Stellar (SLIP-0044).
 * Used for key derivation: m/44'/148'/accountIndex'
 */
const STELLAR_COIN_TYPE = 148

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/**
 * Hardware wallet adapter for Ledger devices.
 *
 * Uses a "bring your own transport" pattern — you instantiate a Ledger
 * transport (e.g. from `@ledgerhq/hw-transport-webusb`) and pass it in via
 * `config.transport`. This keeps the SDK free from a hard dependency on any
 * specific Ledger transport package.
 *
 * @example
 * ```typescript
 * import TransportWebUSB from '@ledgerhq/hw-transport-webusb'
 * import Str from '@ledgerhq/hw-app-str'
 * import { createLedgerAdapter } from '@soroban-resurrect/sdk'
 *
 * const transport = await TransportWebUSB.create()
 * const adapter = createLedgerAdapter({ transport, accountIndex: 0 })
 * await adapter.connect()
 *
 * const result = await sr.submitWithRestore({ transaction, wallet: adapter })
 * ```
 *
 * ### Required peer packages
 * ```
 * npm install @ledgerhq/hw-transport-webusb @ledgerhq/hw-app-str
 * ```
 *
 * ### Key derivation path
 * `m/44'/148'/accountIndex'`  (Stellar BIP44, SLIP-0044 coin type 148)
 */
export class LedgerWalletAdapter implements HardwareWalletAdapter {
  readonly type = 'ledger' as const

  private readonly accountIndex: number
  private transport: unknown
  private strApp: LedgerStrApp | null = null
  private _publicKey: string | null = null
  private _connected: boolean = false

  constructor(config: LedgerAdapterConfig = {}) {
    this.accountIndex = config.accountIndex ?? 0
    this.transport = config.transport ?? null
  }

  /** BIP44 derivation path for the configured account index. */
  private get bip44Path(): string {
    return `m/44'/${STELLAR_COIN_TYPE}'/${this.accountIndex}'`
  }

  /**
   * Opens a connection to the Ledger device and initialises the Stellar app.
   *
   * Requires a transport to be provided in the constructor config. If no
   * transport was provided, this method will throw with a helpful error.
   */
  async connect(): Promise<void> {
    if (!this.transport) {
      throw new Error(
        'LedgerWalletAdapter: no transport provided. ' +
          'Create a transport first (e.g. `await TransportWebUSB.create()`) ' +
          'and pass it as `config.transport`.',
      )
    }

    // Dynamically load @ledgerhq/hw-app-str. If it is not installed the error
    // message explains what to do.
    let StrModule: { default: new (transport: unknown) => LedgerStrApp }
    try {
      StrModule = await import('@ledgerhq/hw-app-str' as string)
    } catch {
      throw new Error(
        'LedgerWalletAdapter: could not load @ledgerhq/hw-app-str. ' +
          'Install it with: npm install @ledgerhq/hw-app-str',
      )
    }

    this.strApp = new StrModule.default(this.transport)
    this._connected = true

    // Pre-fetch and cache the public key on connect.
    const result = await this.strApp.getPublicKey(this.bip44Path)
    this._publicKey = result.publicKey
  }

  /**
   * Closes the connection to the Ledger device.
   */
  async disconnect(): Promise<void> {
    if (this.transport && typeof (this.transport as LedgerTransport).close === 'function') {
      await (this.transport as LedgerTransport).close()
    }
    this.strApp = null
    this._publicKey = null
    this._connected = false
  }

  /**
   * Returns the version of the Stellar app installed on the Ledger device.
   * Requires `connect()` to have been called first.
   */
  async getAppVersion(): Promise<string> {
    this.assertConnected()
    const result = await this.strApp!.getAppConfiguration()
    return result.version
  }

  /**
   * Returns `true` when the adapter has a live connection to the device.
   */
  async isConnected(): Promise<boolean> {
    return this._connected
  }

  /**
   * Returns the Stellar public key for the configured account index.
   * Requires `connect()` to have been called first.
   */
  async getPublicKey(): Promise<string> {
    this.assertConnected()
    if (!this._publicKey) {
      const result = await this.strApp!.getPublicKey(this.bip44Path)
      this._publicKey = result.publicKey
    }
    return this._publicKey
  }

  /**
   * Signs a Stellar transaction XDR using the Ledger Stellar app.
   *
   * The transaction is decoded from XDR, sent to the device for signing, and
   * the signature is appended before the signed XDR is returned.
   *
   * @param txXdr - Base64 XDR of the transaction envelope to sign.
   * @param opts  - Optional network passphrase (defaults to Testnet).
   * @returns Base64 XDR of the signed transaction envelope.
   */
  async signTransaction(
    txXdr: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string> {
    this.assertConnected()

    const networkPassphrase = opts?.networkPassphrase ?? Networks.TESTNET

    // Convert the XDR envelope to a raw Buffer for the Ledger app.
    // The Stellar Ledger app expects the raw transaction bytes (not the envelope).
    const { TransactionBuilder } = await import('@stellar/stellar-sdk')
    const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase)

    // The Ledger Stellar app signs the raw transaction hash bytes.
    const txHash = tx.hash()

    const signResult = await this.strApp!.signHash(this.bip44Path, txHash)

    // Attach the returned signature to the transaction.
    const keypair = (await import('@stellar/stellar-sdk')).Keypair.fromPublicKey(
      await this.getPublicKey(),
    )
    // Convert Uint8Array signature to base64 for addSignature
    const signatureBase64 = btoa(String.fromCharCode(...Array.from(signResult.signature)))
    tx.addSignature(keypair.publicKey(), signatureBase64)

    return tx.toEnvelope().toXDR('base64')
  }

  private assertConnected(): void {
    if (!this._connected || !this.strApp) {
      throw new Error(
        'LedgerWalletAdapter: not connected. Call `connect()` before using the adapter.',
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Trezor
// ---------------------------------------------------------------------------

/**
 * Hardware wallet adapter for Trezor devices.
 *
 * Uses a "bring your own TrezorConnect" pattern — you pass a TrezorConnect
 * instance (from `@trezor/connect-web` or `trezor-connect`) in via
 * `config.trezorConnect`. This keeps the SDK free from a hard dependency on
 * any specific Trezor Connect package.
 *
 * @example
 * ```typescript
 * import TrezorConnect from '@trezor/connect-web'
 * import { createTrezorAdapter } from '@soroban-resurrect/sdk'
 *
 * const adapter = createTrezorAdapter({
 *   trezorConnect: TrezorConnect,
 *   manifest: { email: 'you@example.com', appUrl: 'https://your-app.com' },
 *   accountIndex: 0,
 * })
 * await adapter.connect()
 *
 * const result = await sr.submitWithRestore({ transaction, wallet: adapter })
 * ```
 *
 * ### Required peer packages
 * ```
 * npm install @trezor/connect-web
 * ```
 *
 * ### Key derivation path
 * `m/44'/148'/accountIndex'/0/0`  (Stellar BIP44, full path for Trezor)
 */
export class TrezorWalletAdapter implements HardwareWalletAdapter {
  readonly type = 'trezor' as const

  private readonly accountIndex: number
  private readonly manifest: { email: string; appUrl: string }
  private trezorConnect: TrezorConnectInstance | null
  private _connected: boolean = false
  private _publicKey: string | null = null

  constructor(config: TrezorAdapterConfig) {
    this.accountIndex = config.accountIndex ?? 0
    this.manifest = config.manifest
    this.trezorConnect = (config.trezorConnect as TrezorConnectInstance) ?? null
  }

  /** BIP44 derivation path for the configured account index (full path for Trezor). */
  private get bip44Path(): string {
    return `m/44'/${STELLAR_COIN_TYPE}'/${this.accountIndex}'/0/0`
  }

  /**
   * Initialises TrezorConnect and marks the adapter as connected.
   *
   * Requires a TrezorConnect instance to be provided in the constructor config.
   * If no instance was provided, this method will throw with a helpful error.
   */
  async connect(): Promise<void> {
    if (!this.trezorConnect) {
      throw new Error(
        'TrezorWalletAdapter: no TrezorConnect instance provided. ' +
          'Install @trezor/connect-web and pass the instance as `config.trezorConnect`.',
      )
    }

    await this.trezorConnect.init({
      lazyLoad: true,
      manifest: this.manifest,
    })

    this._connected = true

    // Pre-fetch and cache the public key on connect.
    this._publicKey = await this.fetchPublicKey()
  }

  /**
   * Marks the adapter as disconnected. TrezorConnect does not have an explicit
   * close/disconnect method in all versions, so this is a best-effort cleanup.
   */
  async disconnect(): Promise<void> {
    this._connected = false
    this._publicKey = null
  }

  /**
   * Returns the Trezor firmware / Stellar app version string.
   * Requires `connect()` to have been called first.
   */
  async getAppVersion(): Promise<string> {
    this.assertConnected()

    const result = await this.trezorConnect!.getFeatures()
    if (!result.success) {
      const payload = result.payload as { error: string }
      throw new Error(`TrezorWalletAdapter: getFeatures failed — ${payload.error}`)
    }
    const f = result.payload as TrezorFeatures
    return `${f.major_version}.${f.minor_version}.${f.patch_version}`
  }

  /**
   * Returns `true` when the adapter has been connected via `connect()`.
   */
  async isConnected(): Promise<boolean> {
    return this._connected
  }

  /**
   * Returns the Stellar public key for the configured account index.
   * Requires `connect()` to have been called first.
   */
  async getPublicKey(): Promise<string> {
    this.assertConnected()
    if (!this._publicKey) {
      this._publicKey = await this.fetchPublicKey()
    }
    return this._publicKey
  }

  /**
   * Signs a Stellar transaction XDR using TrezorConnect.
   *
   * @param txXdr - Base64 XDR of the transaction envelope to sign.
   * @param opts  - Optional network passphrase (defaults to Testnet).
   * @returns Base64 XDR of the signed transaction envelope.
   */
  async signTransaction(
    txXdr: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string> {
    this.assertConnected()

    const networkPassphrase = opts?.networkPassphrase ?? Networks.TESTNET
    const { TransactionBuilder, Keypair } = await import('@stellar/stellar-sdk')

    const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase)
    const txEnvelopeXdr = tx.toEnvelope().toXDR('base64')

    // stellarSignTransaction expects the raw transaction XDR (not the envelope).
    // The payload shape matches the Trezor Connect Stellar signing API.
    const result = await this.trezorConnect!.stellarSignTransaction({
      path: this.bip44Path,
      networkPassphrase,
      transaction: { envelopeXdr: txEnvelopeXdr } as unknown as TrezorStellarTransaction,
    })

    if (!result.success) {
      const payload = result.payload as { error: string }
      throw new Error(`TrezorWalletAdapter: signing failed — ${payload.error}`)
    }

    const { signature, publicKey } = result.payload as TrezorStellarSignResult

    // Attach the Trezor signature to the transaction envelope.
    const keypair = Keypair.fromPublicKey(publicKey)
    tx.addSignature(keypair.publicKey(), signature)

    return tx.toEnvelope().toXDR('base64')
  }

  private async fetchPublicKey(): Promise<string> {
    const result = await this.trezorConnect!.stellarGetAddress({
      path: this.bip44Path,
      showOnTrezor: false,
    })

    if (!result.success) {
      const payload = result.payload as { error: string }
      throw new Error(`TrezorWalletAdapter: getAddress failed — ${payload.error}`)
    }

    return (result.payload as { address: string }).address
  }

  private assertConnected(): void {
    if (!this._connected || !this.trezorConnect) {
      throw new Error(
        'TrezorWalletAdapter: not connected. Call `connect()` before using the adapter.',
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Creates a new `LedgerWalletAdapter` instance.
 *
 * @param config - Ledger adapter configuration (transport, accountIndex).
 * @returns A new `LedgerWalletAdapter`.
 *
 * @example
 * ```typescript
 * import TransportWebUSB from '@ledgerhq/hw-transport-webusb'
 * const transport = await TransportWebUSB.create()
 * const adapter = createLedgerAdapter({ transport })
 * await adapter.connect()
 * ```
 */
export function createLedgerAdapter(config: LedgerAdapterConfig = {}): LedgerWalletAdapter {
  return new LedgerWalletAdapter(config)
}

/**
 * Creates a new `TrezorWalletAdapter` instance.
 *
 * @param config - Trezor adapter configuration (trezorConnect, manifest, accountIndex).
 * @returns A new `TrezorWalletAdapter`.
 *
 * @example
 * ```typescript
 * import TrezorConnect from '@trezor/connect-web'
 * const adapter = createTrezorAdapter({
 *   trezorConnect: TrezorConnect,
 *   manifest: { email: 'you@app.com', appUrl: 'https://your-app.com' },
 * })
 * await adapter.connect()
 * ```
 */
export function createTrezorAdapter(config: TrezorAdapterConfig): TrezorWalletAdapter {
  return new TrezorWalletAdapter(config)
}

// ---------------------------------------------------------------------------
// Internal type shims (for the "BYOL" integrations above)
// These describe the minimal surface of third-party types we need without
// importing the actual packages. They are never exported from the SDK.
// ---------------------------------------------------------------------------

interface LedgerTransport {
  close(): Promise<void>
}

interface LedgerStrApp {
  getPublicKey(path: string): Promise<{ publicKey: string }>
  getAppConfiguration(): Promise<{ version: string }>
  signHash(path: string, hash: Uint8Array): Promise<{ signature: Uint8Array }>
}

interface TrezorConnectInstance {
  init(opts: { lazyLoad?: boolean; manifest: { email: string; appUrl: string } }): Promise<void>
  getFeatures(): Promise<{ success: boolean; payload: TrezorFeatures | { error: string } }>
  stellarGetAddress(opts: {
    path: string
    showOnTrezor: boolean
  }): Promise<{ success: boolean; payload: { address: string } | { error: string } }>
  stellarSignTransaction(opts: {
    path: string
    networkPassphrase: string
    transaction: TrezorStellarTransaction
  }): Promise<{ success: boolean; payload: TrezorStellarSignResult | { error: string } }>
}

interface TrezorFeatures {
  major_version: number
  minor_version: number
  patch_version: number
}

interface TrezorStellarTransaction {
  envelopeXdr: string
}

interface TrezorStellarSignResult {
  signature: string
  publicKey: string
}
