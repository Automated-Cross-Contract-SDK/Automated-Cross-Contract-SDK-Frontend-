import {
  isConnected as freighterIsConnected,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction as freighterSignTransaction,
  signAuthEntry as freighterSignAuthEntry,
} from '@stellar/freighter-api'
import { xdr } from '@stellar/stellar-sdk'
import {
  WalletError,
  type WalletAdapter,
  type WalletCapabilities,
  type WalletErrorCode,
} from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/**
 * WalletAdapter implementation for the Freighter browser extension wallet.
 * Wraps `@stellar/freighter-api` to satisfy the SDK's WalletAdapter contract.
 */
export class FreighterAdapter implements WalletAdapter {
  /**
   * Freighter is a software extension wallet. This adapter signs full
   * transaction envelopes (including fee-bump envelopes) via `signTransaction`;
   * it does not wire up CAP-0046 per-entry signing.
   */
  readonly capabilities: WalletCapabilities = {
    signAuthEntry: true,
    feeBump: true,
    hardware: false,
  }

  async isConnected(): Promise<boolean> {
    try {
      const result = await freighterIsConnected()
      if ('error' in result && result.error) {
        return false
      }
      return Boolean(result.isConnected)
    } catch (error) {
      throw normalizeError(error, 'NOT_CONNECTED')
    }
  }

  async getPublicKey() {
    try {
      const access = await requestAccess()
      if ('error' in access && access.error) {
        throw normalizeError(access.error, 'NOT_CONNECTED')
      }
      if (typeof access.address !== 'string' || access.address.length === 0) {
        throw new WalletError('NOT_CONNECTED', 'Freighter: no account was selected')
      }
      return asStellarPublicKey(access.address)
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error, 'NOT_CONNECTED')
    }
  }

  async signTransaction(tx: string, opts?: { networkPassphrase?: string; network?: string }) {
    try {
      const address = await getAddress()
      if ('error' in address && address.error) {
        throw normalizeError(address.error, 'NOT_CONNECTED')
      }
      if (typeof address.address !== 'string' || address.address.length === 0) {
        throw new WalletError('NOT_CONNECTED', 'Freighter: no account is connected')
      }

      const result = await freighterSignTransaction(tx, {
        networkPassphrase: opts?.networkPassphrase,
        address: address.address,
      })

      if ('error' in result && result.error) {
        throw normalizeError(result.error)
      }
      if (typeof result.signedTxXdr !== 'string' || result.signedTxXdr.length === 0) {
        throw new WalletError('UNKNOWN', 'Freighter: wallet returned no signed transaction XDR')
      }

      try {
        xdr.TransactionEnvelope.fromXDR(result.signedTxXdr, 'base64')
      } catch (error) {
        throw new WalletError(
          'UNKNOWN',
          'Freighter: wallet returned invalid signed transaction XDR',
          error,
        )
      }
      return asXdrBase64(result.signedTxXdr)
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error)
    }
  }

  async getNetwork(): Promise<string> {
    try {
      const result = await getNetwork()
      if ('error' in result && result.error) throw normalizeError(result.error)
      return result.networkPassphrase
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error)
    }
  }

  async signAuthEntry(
    authEntryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<string> {
    try {
      const result = await freighterSignAuthEntry(authEntryXdr, opts)
      if ('error' in result && result.error) throw normalizeError(result.error)
      if (!result.signedAuthEntry) {
        throw new WalletError('UNKNOWN', 'Freighter: missing signed authorization entry')
      }
      return result.signedAuthEntry.toString('base64')
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error)
    }
  }
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
      : /not installed|unavailable|not connected|no account|access/.test(lower)
        ? 'NOT_CONNECTED'
        : fallback
  return new WalletError(code, `Freighter: ${message}`, error)
}
