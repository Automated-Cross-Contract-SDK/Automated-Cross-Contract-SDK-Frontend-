import {
  isConnected as freighterIsConnected,
  requestAccess,
  getAddress,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api'
import type { WalletAdapter, WalletCapabilities } from '@soroban-resurrect/sdk'
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
    signAuthEntry: false,
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
    const access = await requestAccess()
    if ('error' in access && access.error) {
      throw new Error(`Freighter: ${access.error}`)
    }
    return asStellarPublicKey(access.address)
  }

  async signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ) {
    const address = await getAddress()
    if ('error' in address && address.error) {
      throw new Error(`Freighter: ${address.error}`)
    }

    const result = await freighterSignTransaction(tx, {
      networkPassphrase: opts?.networkPassphrase,
      address: address.address,
    })

    if ('error' in result && result.error) {
      throw new Error(`Freighter: ${result.error}`)
    }

    return asXdrBase64(result.signedTxXdr)
  }
}
