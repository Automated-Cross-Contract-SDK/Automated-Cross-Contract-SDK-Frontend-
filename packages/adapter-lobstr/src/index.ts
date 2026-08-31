import {
  isConnected as lobstrIsConnected,
  getPublicKey as lobstrGetPublicKey,
  signTransaction as lobstrSignTransaction,
} from '@lobstrco/signer-extension-api'
import type { WalletAdapter } from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/**
 * WalletAdapter implementation for the LOBSTR browser extension wallet.
 * Wraps `@lobstrco/signer-extension-api` to satisfy the SDK's WalletAdapter contract.
 */
export class LobstrAdapter implements WalletAdapter {
  async isConnected(): Promise<boolean> {
    return lobstrIsConnected()
  }

  async getPublicKey() {
    return asStellarPublicKey(await lobstrGetPublicKey())
  }

  async signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ) {
    return asXdrBase64(await lobstrSignTransaction(tx, opts?.networkPassphrase))
  }
}
