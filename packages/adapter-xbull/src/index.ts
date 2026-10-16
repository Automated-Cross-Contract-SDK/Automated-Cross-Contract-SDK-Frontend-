import { XBullWalletConnect } from '@creit.tech/xbull-wallet-connect'
import { WalletError, type WalletAdapter, type WalletCapabilities } from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

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
  private connected = false

  async isConnected(): Promise<boolean> {
    return this.connected
  }

  async getPublicKey() {
    return this.connect()
  }

  async connect() {
    try {
      const publicKey = await this.connector.connect()
      this.connected = true
      return asStellarPublicKey(publicKey)
    } catch (error) {
      this.connected = false
      throw normalizeError(error)
    }
  }

  async signTransaction(tx: string, opts?: { networkPassphrase?: string; network?: string }) {
    try {
      const publicKey = await this.connector.connect()
      this.connected = true
      const signed = await this.connector.sign({
        xdr: tx,
        publicKey,
        network: opts?.networkPassphrase,
      })
      return asXdrBase64(signed)
    } catch (error) {
      this.connected = false
      throw normalizeError(error)
    }
  }
}

function normalizeError(error: unknown): WalletError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  const code = /reject|declin|cancel|denied/.test(lower)
    ? 'USER_REJECTED'
    : /network|chain/.test(lower)
      ? 'NETWORK_MISMATCH'
      : /not connected|unavailable/.test(lower)
        ? 'NOT_CONNECTED'
        : 'UNKNOWN'
  return new WalletError(code, `xBull: ${message}`, error)
}
