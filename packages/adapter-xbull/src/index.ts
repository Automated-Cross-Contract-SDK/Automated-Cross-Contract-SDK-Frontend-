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
  private publicKey: string | undefined

  async isConnected(): Promise<boolean> {
    return this.publicKey !== undefined
  }

  async getPublicKey() {
    const publicKey = await this.connector.connect()
    this.publicKey = publicKey
    return asStellarPublicKey(publicKey)
  }

  async signTransaction(tx: string, opts?: { networkPassphrase?: string; network?: string }) {
    if (!this.publicKey) {
      throw new Error('xBull: wallet is not connected')
    }

    try {
      const signed = await this.connector.sign({
        xdr: tx,
        publicKey: this.publicKey,
        network: opts?.networkPassphrase,
      })
      return asXdrBase64(signed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = /reject|declin|cancel|denied/.test(message.toLowerCase())
        ? 'USER_REJECTED'
        : 'UNKNOWN'
      throw new WalletError(code, `xBull: ${message}`, error)
    }
  }
}
