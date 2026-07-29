import albedo from '@albedo-link/intent'
import type { WalletAdapter } from '@soroban-resurrect/sdk'

/**
 * WalletAdapter implementation for the Albedo web-based wallet.
 * Wraps `@albedo-link/intent` to satisfy the SDK's WalletAdapter contract.
 */
export class AlbedoAdapter implements WalletAdapter {
  private publicKey: string | undefined

  async isConnected(): Promise<boolean> {
    return this.publicKey !== undefined
  }

  async getPublicKey(): Promise<string> {
    const result = await albedo.publicKey({})
    this.publicKey = result.pubkey
    return result.pubkey
  }

  async signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string> {
    const result = await albedo.tx({
      xdr: tx,
      network: opts?.network ?? 'testnet',
      networkPassphrase: opts?.networkPassphrase,
      submit: false,
    })
    return result.signed_envelope_xdr
  }
}
