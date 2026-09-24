import {
  isConnected as lobstrIsConnected,
  getPublicKey as lobstrGetPublicKey,
  signTransaction as lobstrSignTransaction,
} from '@lobstrco/signer-extension-api'
import { WalletError, type WalletAdapter, type WalletCapabilities } from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/**
 * WalletAdapter implementation for the LOBSTR browser extension wallet.
 * Wraps `@lobstrco/signer-extension-api` to satisfy the SDK's WalletAdapter contract.
 */
export class LobstrAdapter implements WalletAdapter {
  /**
   * LOBSTR's signer extension signs full transaction envelopes (including
   * fee-bump envelopes) via `signTransaction`. It does not expose CAP-0046
   * per-entry signing.
   */
  readonly capabilities: WalletCapabilities = {
    signAuthEntry: false,
    feeBump: true,
    hardware: false,
  }

  async isConnected(): Promise<boolean> {
    return lobstrIsConnected()
  }

  async getPublicKey() {
    return asStellarPublicKey(await lobstrGetPublicKey())
  }

  async signTransaction(
    tx: string,
    // LOBSTR's signer API signs for the network the extension is configured
    // for and takes only the transaction XDR — network options are ignored.
    _opts?: { networkPassphrase?: string; network?: string },
  ) {
    try {
      return asXdrBase64(await lobstrSignTransaction(tx))
    } catch (error) {
      throw normalizeError(error)
    }
  }
}

function normalizeError(error: unknown): WalletError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  const code = /reject|declin|cancel|denied/.test(lower)
    ? 'USER_REJECTED'
    : /network/.test(lower)
      ? 'NETWORK_MISMATCH'
      : /not connected/.test(lower)
        ? 'NOT_CONNECTED'
        : 'UNKNOWN'
  return new WalletError(code, `LOBSTR: ${message}`, error)
}
