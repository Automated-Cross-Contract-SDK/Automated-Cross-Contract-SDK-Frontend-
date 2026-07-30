import {
  isConnected as lobstrIsConnected,
  getPublicKey as lobstrGetPublicKey,
  signTransaction as lobstrSignTransaction,
} from '@lobstrco/signer-extension-api'
import type { WalletAdapter } from '@soroban-resurrect/sdk'

/**
 * WalletAdapter implementation for the LOBSTR browser extension wallet.
 * Wraps `@lobstrco/signer-extension-api` to satisfy the SDK's WalletAdapter contract.
 */
export class LobstrAdapter implements WalletAdapter {
  async isConnected(): Promise<boolean> {
    return lobstrIsConnected()
  }

  async getPublicKey(): Promise<string> {
    return lobstrGetPublicKey()
  }

  async signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string> {
    return lobstrSignTransaction(tx, opts?.networkPassphrase)
  }
}
