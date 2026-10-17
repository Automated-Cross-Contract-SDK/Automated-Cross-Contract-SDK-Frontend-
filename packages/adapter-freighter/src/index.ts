import {
  isConnected as freighterIsConnected,
  requestAccess,
  getAddress,
  getNetwork as freighterGetNetwork,
  signTransaction as freighterSignTransaction,
  signAuthEntry as freighterSignAuthEntry,
} from '@stellar/freighter-api'
import { WalletError, type WalletAdapter, type WalletCapabilities } from '@soroban-resurrect/sdk'
import { asStellarPublicKey, asXdrBase64 } from '@soroban-resurrect/sdk'

/** Network options accepted when signing with Freighter. */
export interface FreighterSignOptions {
  /** Expected Stellar passphrase; must match the network selected in Freighter. */
  networkPassphrase?: string
  /** Expected Freighter network label (for example, `testnet` or `public`). */
  network?: string
}

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
    const result = await freighterIsConnected()
    if ('error' in result && result.error) {
      return false
    }
    return Boolean(result.isConnected)
  }

  async getPublicKey() {
    try {
      const access = await requestAccess()
      if ('error' in access && access.error) {
        throw normalizeError(access.error)
      }
      return asStellarPublicKey(access.address)
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error)
    }
  }

  async signTransaction(tx: string, opts?: FreighterSignOptions) {
    try {
      const networkPassphrase = await resolveSigningNetwork(opts)
      const address = await getAddress()
      if ('error' in address && address.error) throw normalizeError(address.error)

      const result = await freighterSignTransaction(tx, {
        networkPassphrase,
        address: address.address,
      })

      if ('error' in result && result.error) throw normalizeError(result.error)

      return asXdrBase64(result.signedTxXdr)
    } catch (error) {
      if (error instanceof WalletError) throw error
      throw normalizeError(error)
    }
  }

  async getNetwork(): Promise<string> {
    try {
      const result = await freighterGetNetwork()
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

async function resolveSigningNetwork(opts?: FreighterSignOptions): Promise<string | undefined> {
  if (!opts?.networkPassphrase && !opts?.network) return opts?.networkPassphrase

  const selected = await freighterGetNetwork()
  if ('error' in selected && selected.error) throw normalizeError(selected.error)

  if (opts.networkPassphrase && selected.networkPassphrase !== opts.networkPassphrase) {
    throw new WalletError(
      'NETWORK_MISMATCH',
      'Freighter is set to a different network than the requested network passphrase',
      selected,
    )
  }

  if (
    opts.network &&
    normalizeNetworkLabel(opts.network) !== normalizeNetworkLabel(selected.network) &&
    opts.network !== selected.networkPassphrase
  ) {
    throw new WalletError(
      'NETWORK_MISMATCH',
      `Freighter is set to ${selected.network}, not the requested ${opts.network}`,
      selected,
    )
  }

  return opts.networkPassphrase ?? selected.networkPassphrase
}

function normalizeNetworkLabel(network: string): string {
  const normalized = network.trim().toLowerCase()
  return normalized === 'mainnet' ? 'public' : normalized
}

function normalizeError(error: unknown): WalletError {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : String(error)
  const lower = message.toLowerCase()
  const code = /reject|declin|cancel|denied/.test(lower)
    ? 'USER_REJECTED'
    : /network/.test(lower)
      ? 'NETWORK_MISMATCH'
      : /not connected|not allowed|not authorized/.test(lower)
        ? 'NOT_CONNECTED'
        : 'UNKNOWN'
  return new WalletError(code, `Freighter: ${message}`, error)
}
