import { XBullWalletConnect } from '@creit.tech/xbull-wallet-connect'
import {
  WalletError,
  type WalletAdapter,
  type WalletCapabilities,
  type WalletErrorCode,
} from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015'

function resolveNetwork(opts?: { networkPassphrase?: string; network?: string }): string | undefined {
  const network = opts?.network
  const networkPassphrase = opts?.networkPassphrase
  const expectedPassphrase =
    network === 'testnet'
      ? TESTNET_PASSPHRASE
      : network === 'public' || network === 'mainnet'
        ? PUBLIC_PASSPHRASE
        : undefined

  if (network && !expectedPassphrase) {
    throw new WalletError('NETWORK_MISMATCH', `xBull: unsupported network "${network}"`)
  }
  if (expectedPassphrase && networkPassphrase && expectedPassphrase !== networkPassphrase) {
    throw new WalletError('NETWORK_MISMATCH', 'xBull: network and networkPassphrase disagree')
  }
  return networkPassphrase ?? expectedPassphrase
}

function normalizeError(error: unknown, fallback: WalletErrorCode = 'UNKNOWN'): WalletError {
  if (error instanceof WalletError) return error
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error)
  const lower = message.toLowerCase()
  const code = /reject|declin|cancel|denied/.test(lower)
    ? 'USER_REJECTED'
    : /network/.test(lower)
      ? 'NETWORK_MISMATCH'
      : /not connected|not installed|unavailable/.test(lower)
        ? 'NOT_CONNECTED'
        : fallback
  return new WalletError(code, `xBull: ${message}`, error)
}

/**
 * WalletAdapter implementation for the xBull browser extension wallet.
 * Wraps `@creit.tech/xbull-wallet-connect` to satisfy the SDK's WalletAdapter contract.
 */
export class XBullAdapter implements WalletAdapter {
  /**
   * xBull is a software extension wallet. It signs full transaction envelopes
   * (including fee-bump envelopes) via its connector; it does not expose
   * CAP-0046 per-entry signing through this adapter.
   */
  readonly capabilities: WalletCapabilities = {
    signAuthEntry: false,
    feeBump: true,
    hardware: false,
  }

  private readonly connector = new XBullWalletConnect()
  private publicKey: string | undefined

  async isConnected(): Promise<boolean> {
    return this.publicKey !== undefined
  }

  async disconnect(): Promise<void> {
    this.connector.closeWallet()
    this.publicKey = undefined
  }

  async getPublicKey() {
    this.publicKey = undefined
    try {
      const publicKey = await this.connector.connect()
      if (typeof publicKey !== 'string' || publicKey.length === 0) {
        throw new WalletError('NOT_CONNECTED', 'xBull: connection returned no public key')
      }
      this.publicKey = publicKey
      return asStellarPublicKey(publicKey)
    } catch (error) {
      throw normalizeError(error, 'NOT_CONNECTED')
    }
  }

  async signTransaction(tx: string, opts?: { networkPassphrase?: string; network?: string }) {
    if (!this.publicKey) {
      throw new WalletError('NOT_CONNECTED', 'xBull: wallet is not connected')
    }

    try {
      const signed = await this.connector.sign({
        xdr: tx,
        publicKey: this.publicKey,
        network: resolveNetwork(opts),
      })
      if (typeof signed !== 'string' || signed.length === 0) {
        throw new WalletError('UNKNOWN', 'xBull: wallet returned no signed transaction XDR')
      }
      return asXdrBase64(signed)
    } catch (error) {
      throw normalizeError(error)
    }
  }
}
