import albedo from '@albedo-link/intent'
import { WalletError, type WalletAdapter, type WalletCapabilities } from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/**
 * WalletAdapter implementation for the Albedo web-based wallet.
 * Wraps `@albedo-link/intent` to satisfy the SDK's WalletAdapter contract.
 */
export class AlbedoAdapter implements WalletAdapter {
  /**
   * Albedo is a software web wallet. It signs full transaction envelopes
   * (including fee-bump envelopes) via `albedo.tx`; it does not expose
   * CAP-0046 per-entry signing through this adapter.
   */
  readonly capabilities: WalletCapabilities = {
    signAuthEntry: false,
    feeBump: true,
    hardware: false,
  }

  async isConnected(): Promise<boolean> {
    return false
  }

  async getPublicKey() {
    return this.connect()
  }

  async connect() {
    try {
      const result = await albedo.publicKey({})
      return asStellarPublicKey(result.pubkey)
    } catch (error) {
      throw normalizeError(error)
    }
  }

  async signTransaction(tx: string, opts?: { networkPassphrase?: string; network?: string }) {
    try {
      const result = await albedo.tx({
        xdr: tx,
        network: opts?.network ?? 'testnet',
        networkPassphrase: opts?.networkPassphrase,
        submit: false,
      })
      return asXdrBase64(result.signed_envelope_xdr)
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
    : /network|chain/.test(lower)
      ? 'NETWORK_MISMATCH'
      : 'UNKNOWN'
  return new WalletError(code, `Albedo: ${message}`, error)
}
