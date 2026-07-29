import { XBullWalletConnect } from '@creit.tech/xbull-wallet-connect'
import type { WalletAdapter } from '@soroban-resurrect/sdk'

/**
 * WalletAdapter implementation for the xBull browser extension wallet.
 * Wraps `@creit.tech/xbull-wallet-connect` to satisfy the SDK's WalletAdapter contract.
 */
export class XBullAdapter implements WalletAdapter {
  private readonly connector = new XBullWalletConnect()
  private publicKey: string | undefined

  async isConnected(): Promise<boolean> {
    return this.publicKey !== undefined
  }

  async getPublicKey(): Promise<string> {
    const publicKey = await this.connector.connect()
    this.publicKey = publicKey
    return publicKey
  }

  async signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string> {
    if (!this.publicKey) {
      throw new Error('xBull: wallet is not connected')
    }

    return this.connector.sign({
      xdr: tx,
      publicKey: this.publicKey,
      network: opts?.networkPassphrase,
    })
  }
}
