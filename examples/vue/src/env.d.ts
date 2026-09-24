/// <reference types="vite/client" />

import type { StellarWallet } from './wallet.js'

declare global {
  interface Window {
    /** Freighter's injected browser API, present once the extension is installed. */
    stellar?: StellarWallet
  }

  interface ImportMetaEnv {
    readonly VITE_RPC_URL?: string
    readonly VITE_NETWORK_PASSPHRASE?: string
    readonly VITE_CONTRACT_ID?: string
    readonly VITE_USE_PLUGIN?: string
  }
}

export {}
