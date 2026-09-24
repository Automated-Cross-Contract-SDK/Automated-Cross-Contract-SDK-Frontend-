import { Networks } from '@stellar/stellar-sdk'

/**
 * Configuration that is safe to share with the browser bundle.
 *
 * Every value here comes from a `NEXT_PUBLIC_*` variable, which Next.js
 * inlines at build time. The server-only RPC configuration lives in
 * `server-config.ts` instead, so it is never shipped to the client.
 */
export const CLIENT_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org'

export const CLIENT_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET

export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'

/** Amount (in the contract's units) sent by the demo `withdraw` call. */
export const WITHDRAW_AMOUNT = 1000
