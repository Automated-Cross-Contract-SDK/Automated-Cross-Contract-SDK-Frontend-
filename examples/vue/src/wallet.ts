import { asStellarPublicKey, asXdrBase64, type WalletAdapter } from '@soroban-resurrect/sdk'

/**
 * Freighter's injected browser API (`window.stellar`).
 *
 * Declared structurally so the example does not need `@stellar/freighter-api`
 * as a dependency — `wallet.ts` is the only place that touches it.
 */
export interface StellarWallet {
  isConnected(): Promise<{ isConnected: boolean }>
  connect(): Promise<{ publicKey: string }>
  getPublicKey(): Promise<string>
  signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string>
}

/** Returns Freighter, or throws a message the UI can show as-is. */
export function getStellarWallet(): StellarWallet {
  if (typeof window === 'undefined' || !window.stellar) {
    throw new Error('Freighter wallet not found. Please install the Freighter extension.')
  }
  return window.stellar
}

/** Prompts Freighter to connect and returns the selected account's public key. */
export async function connectWallet(): Promise<string> {
  const stellar = getStellarWallet()
  await stellar.connect()
  return stellar.getPublicKey()
}

/**
 * Adapts the Freighter browser extension to the SDK's `WalletAdapter` shape.
 *
 * The SDK's branded types (`StellarPublicKey`, `XdrBase64`) are plain strings at
 * runtime, so they are cast once here — at the one boundary where values come
 * from the wallet instead of the network.
 */
export function createWalletAdapter(): WalletAdapter {
  return {
    isConnected: async () => true,
    getPublicKey: async () => asStellarPublicKey(await getStellarWallet().getPublicKey()),
    signTransaction: async (tx, opts) =>
      asXdrBase64(await getStellarWallet().signTransaction(tx, opts)),
  }
}
