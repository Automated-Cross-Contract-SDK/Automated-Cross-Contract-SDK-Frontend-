/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK?: 'testnet' | 'futurenet' | 'mainnet'
  readonly VITE_WALLET?: string
  readonly VITE_CONTRACT_ID?: string
  readonly VITE_CONTRACT_FN?: string
}
