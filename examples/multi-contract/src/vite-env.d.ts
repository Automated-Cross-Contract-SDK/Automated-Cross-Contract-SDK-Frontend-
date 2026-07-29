/// <reference types="vite/client" />

interface StellarWallet {
  isConnected(): Promise<{ isConnected: boolean }>
  connect(): Promise<{ publicKey: string }>
  getPublicKey(): Promise<string>
  signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string>
}

interface Window {
  stellar?: StellarWallet
}
