import {
  WalletError,
  type WalletAdapter,
  type WalletCapabilities,
  type WalletErrorCode,
} from '@soroban-resurrect/sdk'
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

/** Maps SDK network options to Rabet's supported network identifiers. */
function toRabetNetwork(network?: string, networkPassphrase?: string): string {
  const requestedNetwork =
    network === 'testnet'
      ? RABET_TESTNET
      : network === 'public' || network === 'mainnet'
        ? RABET_PUBLIC
        : undefined
  if (network && !requestedNetwork) {
    throw new WalletError('NETWORK_MISMATCH', `Rabet: unsupported network "${network}"`)
  }
  const passphraseNetwork = networkPassphrase
    ? networkPassphrase.includes('Public Global Stellar Network')
      ? RABET_PUBLIC
      : networkPassphrase.includes('Test SDF Network')
        ? RABET_TESTNET
        : undefined
    : undefined
  if (networkPassphrase && !passphraseNetwork) {
    throw new WalletError(
      'NETWORK_MISMATCH',
      'Rabet: unsupported network passphrase; use Stellar testnet or public network',
    )
  }
  if (requestedNetwork && passphraseNetwork && requestedNetwork !== passphraseNetwork) {
    throw new WalletError('NETWORK_MISMATCH', 'Rabet: network and networkPassphrase disagree')
  }
  return requestedNetwork ?? passphraseNetwork ?? RABET_TESTNET
}

function toRabetError(err: unknown, fallback: WalletErrorCode = 'UNKNOWN'): WalletError {
  if (err instanceof WalletError) return err
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String(err.message)
        : String(err)
  const lower = message.toLowerCase()
  const code = /reject|declin|cancel|denied/.test(lower)
    ? 'USER_REJECTED'
    : /network/.test(lower)
      ? 'NETWORK_MISMATCH'
      : /not installed|unavailable|not connected|no account/.test(lower)
        ? 'NOT_CONNECTED'
        : fallback
  return new WalletError(code, `Rabet: ${message}`, err)
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
      throw new WalletError(
        'NOT_CONNECTED',
        'Rabet: extension not found. Install Rabet (https://rabet.io) or pass a ' +
          '`rabet` instance to the RabetAdapter constructor.',
      )
    }
    return this.rabet
  }

  async isConnected(): Promise<boolean> {
    if (!this.rabet) return false
    if (typeof this.rabet.isUnlocked === 'function') {
      try {
        const unlocked = Boolean(await this.rabet.isUnlocked())
        if (!unlocked) this.publicKey = undefined
        return unlocked
      } catch (err) {
        throw toRabetError(err, 'NOT_CONNECTED')
      }
    }
    return this.publicKey !== undefined
  }

  async disconnect(): Promise<void> {
    this.publicKey = undefined
    try {
      await this.rabet?.disconnect?.()
    } catch (err) {
      throw toRabetError(err)
    }
  }

  async getPublicKey() {
    try {
      const result = await this.getApi().connect()
      if (!result || typeof result.publicKey !== 'string' || result.publicKey.length === 0) {
        throw new WalletError('NOT_CONNECTED', 'Rabet: connection returned no public key')
      }
      this.publicKey = result.publicKey
      return asStellarPublicKey(result.publicKey)
    } catch (err) {
      throw toRabetError(err, 'NOT_CONNECTED')
    }
  }

  async signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ) {
    const api = this.getApi()
    try {
      const result = await api.sign(tx, toRabetNetwork(opts?.network, opts?.networkPassphrase))
      if (!result || typeof result.xdr !== 'string' || result.xdr.length === 0) {
        throw new WalletError('UNKNOWN', 'Rabet: wallet returned no signed transaction XDR')
      }
      return asXdrBase64(result.xdr)
    } catch (err) {
      throw toRabetError(err)
    }
  }
}
