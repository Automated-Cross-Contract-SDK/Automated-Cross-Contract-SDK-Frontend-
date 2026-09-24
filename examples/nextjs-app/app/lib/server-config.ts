import { Networks } from '@stellar/stellar-sdk'
import { SorobanResurrect, type RestoreCostEstimate } from '@soroban-resurrect/sdk'
import { buildWithdrawTransaction } from './withdraw-tx'
import { CONTRACT_ID } from './client-config'

/**
 * Server-only RPC configuration.
 *
 * These variables are deliberately **not** prefixed with `NEXT_PUBLIC_`, so
 * Next.js never inlines them into the browser bundle. Only Server Components
 * (and Route Handlers) can read them, which lets the read-only detection calls
 * run against an endpoint that is never exposed to the client.
 *
 * Import this module from Server Components only — importing it into a
 * `'use client'` module would silently resolve these values to `undefined`.
 */
const SERVER_RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'

const SERVER_NETWORK_PASSPHRASE = process.env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.TESTNET

/** Result of a server-side archived-entry check for one account. */
export interface ServerRestoreDetection {
  /** `true` when the withdraw transaction is blocked by archived ledger entries. */
  needsRestore: boolean
  /**
   * Cost estimate for the restore (only computed when a restore is needed).
   * `null` when the transaction does not need restoring.
   */
  estimate: RestoreCostEstimate | null
}

/**
 * Runs the SDK's read-only detection against the server-configured RPC.
 *
 * This is safe to run outside the browser: `needsRestore` performs a
 * simulation and `estimateRestoreCost` reads the restore response's resource
 * fee — neither touches a wallet or signs anything. Signing and submission
 * stay in the client, which is where the wallet lives.
 *
 * @param account - Public key whose withdraw transaction should be checked.
 */
export async function detectRestoreForAccount(account: string): Promise<ServerRestoreDetection> {
  const resurrect = new SorobanResurrect({
    rpcUrl: SERVER_RPC_URL,
    networkPassphrase: SERVER_NETWORK_PASSPHRASE,
  })

  const transaction = await buildWithdrawTransaction(
    resurrect.server,
    account,
    SERVER_NETWORK_PASSPHRASE,
    CONTRACT_ID,
  )

  const needsRestore = await resurrect.needsRestore(transaction)
  const estimate = needsRestore ? await resurrect.estimateRestoreCost(transaction) : null

  return { needsRestore, estimate }
}
