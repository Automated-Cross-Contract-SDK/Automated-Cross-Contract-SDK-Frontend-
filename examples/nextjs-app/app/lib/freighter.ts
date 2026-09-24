/**
 * Minimal surface of the Freighter wallet extension used by this example.
 * Declared here (rather than per component) so the global `Window`
 * augmentation appears exactly once.
 */
export interface FreighterApi {
  isConnected(): Promise<{ isConnected: boolean }>
  getAddress(): Promise<{ address: string }>
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string },
  ): Promise<{ signedTxXdr: string }>
}

declare global {
  interface Window {
    freighterApi?: FreighterApi
  }
}

/** Returns the injected Freighter API, or `null` when running without it. */
export function getFreighterApi(): FreighterApi | null {
  if (typeof window === 'undefined') return null
  return window.freighterApi ?? null
}
