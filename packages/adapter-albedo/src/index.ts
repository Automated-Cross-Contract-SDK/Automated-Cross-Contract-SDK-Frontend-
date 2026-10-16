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

  private publicKey: string | undefined

  async isConnected(): Promise<boolean> {
    return this.publicKey !== undefined
  }

  async getPublicKey() {
    try {
      const result = await albedo.publicKey({})
      if (!result || typeof result.pubkey !== 'string' || result.pubkey.length === 0) {
        throw new WalletError('NOT_CONNECTED', 'Albedo: wallet returned no public key')
      }
      this.publicKey = result.pubkey
      return asStellarPublicKey(result.pubkey)
    } catch (error) {
      this.publicKey = undefined
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
      if (
        !result ||
        typeof result.signed_envelope_xdr !== 'string' ||
        result.signed_envelope_xdr.length === 0
      ) {
        throw new WalletError('UNKNOWN', 'Albedo: wallet returned no signed transaction XDR')
      }
      return asXdrBase64(result.signed_envelope_xdr)
    } catch (error) {
      throw normalizeError(error)
    }
  }
}

function normalizeError(error: unknown): WalletError {
  if (error instanceof WalletError) return error
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  const code = /reject|declin|cancel|denied/.test(lower)
    ? 'USER_REJECTED'
    : /network/.test(lower)
      ? 'NETWORK_MISMATCH'
      : /not installed|unavailable|not connected/.test(lower)
        ? 'NOT_CONNECTED'
        : 'UNKNOWN'
  return new WalletError(code, `Albedo: ${message}`, error)
}
