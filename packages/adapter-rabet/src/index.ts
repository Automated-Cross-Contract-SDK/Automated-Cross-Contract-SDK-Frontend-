import type { WalletAdapter, WalletCapabilities } from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/**
 * Minimal surface of the Rabet browser extension API (`window.rabet`).
 * See https://rabet.io/docs — only the members this adapter needs are typed.
 */
export interface RabetApi {
  connect(): Promise<{ publicKey: string }>
  disconnect?(): Promise<void> | void
  sign(
    xdr: string,
    network: string,
  ): Promise<{ xdr: string }>
  isUnlocked?(): Promise<boolean> | boolean
}

declare global {
  interface Window {
    rabet?: RabetApi
  }
}

/** Rabet uses these string identifiers for its networks in `sign()`. */
const RABET_TESTNET = 'testnet'
const RABET_PUBLIC = 'mainnet'

/** Maps a Stellar network passphrase to Rabet's network identifier. */
function toRabetNetwork(networkPassphrase?: string): string {
  if (!networkPassphrase) return RABET_TESTNET
  return networkPassphrase.includes('Public Global Stellar Network')
    ? RABET_PUBLIC
    : RABET_TESTNET
}

/** Normalizes an unknown thrown value into an `Error` with a `Rabet:` prefix. */
function toRabetError(err: unknown): Error {
  if (err instanceof Error) return new Error(`Rabet: ${err.message}`)
  if (typeof err === 'string') return new Error(`Rabet: ${err}`)
  if (err && typeof err === 'object' && 'message' in err) {
    return new Error(`Rabet: ${String((err as { message: unknown }).message)}`)
  }
  return new Error('Rabet: unknown error')
}

/**
 * Options for {@link RabetAdapter}.
 */
export interface RabetAdapterOptions {
  /**
   * Override the Rabet API object. Defaults to `window.rabet`. Useful for
   * testing or non-browser environments.
   */
  rabet?: RabetApi
}

/**
 * WalletAdapter implementation for the Rabet browser extension wallet.
 *
 * Rabet exposes a browser-API surface similar to Freighter's via the global
 * `window.rabet` object. This adapter follows the same conventions as the other
 * adapter packages (`asStellarPublicKey` / `asXdrBase64`, error normalization).
 *
 * @example
 * ```ts
 * import { RabetAdapter } from '@soroban-resurrect/adapter-rabet'
 *
 * const wallet = new RabetAdapter()
 * const result = await sr.submitWithRestore({ transaction, wallet })
 * ```
 */
export class RabetAdapter implements WalletAdapter {
  /**
   * Rabet is a software extension wallet. It signs full transaction envelopes
   * (including fee-bump envelopes) via `rabet.sign`; it does not expose CAP-0046
   * per-entry signing.
   */
  readonly capabilities: WalletCapabilities = {
    signAuthEntry: false,
    feeBump: true,
    hardware: false,
  }

  private readonly rabet?: RabetApi
  private publicKey: string | undefined

  constructor(options: RabetAdapterOptions = {}) {
    this.rabet = options.rabet ?? (typeof window !== 'undefined' ? window.rabet : undefined)
  }

  /** Returns the injected Rabet API or throws a helpful error if it is missing. */
  private getApi(): RabetApi {
    if (!this.rabet) {
      throw new Error(
        'Rabet: extension not found. Install Rabet (https://rabet.io) or pass a ' +
          '`rabet` instance to the RabetAdapter constructor.',
      )
    }
    return this.rabet
  }

  async isConnected(): Promise<boolean> {
    if (!this.rabet) return false
    if (this.publicKey !== undefined) return true
    try {
      if (typeof this.rabet.isUnlocked === 'function') {
        return Boolean(await this.rabet.isUnlocked())
      }
    } catch {
      return false
    }
    return false
  }

  async getPublicKey() {
    try {
      const result = await this.getApi().connect()
      this.publicKey = result.publicKey
      return asStellarPublicKey(result.publicKey)
    } catch (err) {
      throw toRabetError(err)
    }
  }

  async signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ) {
    try {
      const result = await this.getApi().sign(tx, toRabetNetwork(opts?.networkPassphrase))
      return asXdrBase64(result.xdr)
    } catch (err) {
      throw toRabetError(err)
    }
  }
}
