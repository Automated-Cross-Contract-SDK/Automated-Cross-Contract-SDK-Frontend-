// @ts-check
// Server-side maintenance worker: scans a contract for archived / soon-to-expire
// entries and restores them with restoreKeys(). Runs with plain `node` — no bundler.
import { SorobanResurrect, getExpiringEntriesForContract } from '@soroban-resurrect/sdk'
import { Keypair, Networks, TransactionBuilder, xdr } from '@stellar/stellar-sdk'

const env = process.env
const RPC_URL = env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.TESTNET
const CONTRACT_ID = required('CONTRACT_ID')
const SECRET = required('WORKER_SECRET_KEY')
const INTERVAL_MS = Number(env.SCAN_INTERVAL_SECONDS ?? 3600) * 1000
const EXPIRING_WITHIN = Number(env.EXPIRING_WITHIN_LEDGERS ?? 17_280)
const ONCE = process.argv.includes('--once')

/** @param {string} name */
function required(name) {
  const value = env[name]
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`)
    process.exit(1)
  }
  return value
}

/**
 * A plain WalletAdapter backed by a local signing key — no browser, no extension.
 * @param {Keypair} keypair
 * @returns {import('@soroban-resurrect/sdk').WalletAdapter}
 */
function keypairWallet(keypair) {
  return {
    isConnected: async () => true,
    getPublicKey: async () => /** @type {any} */ (keypair.publicKey()),
    signTransaction: async (txXdr, opts) => {
      const tx = TransactionBuilder.fromXDR(txXdr, opts?.networkPassphrase ?? NETWORK_PASSPHRASE)
      tx.sign(keypair)
      return /** @type {any} */ (tx.toXDR())
    },
  }
}

const resurrect = new SorobanResurrect({ rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE })
const wallet = keypairWallet(Keypair.fromSecret(SECRET))
const log = (/** @type {string} */ msg) => console.log(`[${new Date().toISOString()}] ${msg}`)

async function tick() {
  log(`Scanning ${CONTRACT_ID}`)
  const scan = await getExpiringEntriesForContract(resurrect.server, CONTRACT_ID, {
    expiringWithinLedgers: EXPIRING_WITHIN,
  })
  const keys = [
    ...scan.archived.map((e) => e.key),
    ...scan.expiringSoon.map((e) => xdr.LedgerKey.fromXDR(e.keyBase64, 'base64')),
  ]
  log(
    `Ledger ${scan.currentLedger}: ${scan.entries.length} scanned, ` +
      `${scan.archived.length} archived, ${scan.expiringSoon.length} expiring soon`,
  )
  if (keys.length === 0) return

  const result = await resurrect.restoreKeys(keys, wallet, {
    onSigningRestore: () => log(`Signing restore for ${keys.length} key(s)`),
    onSubmittingRestore: () => log('Submitting restore'),
    onRestoreSubmitted: (hash) => log(`Restore submitted: ${hash}`),
    onRestoreConfirmed: (hash) => log(`Restore confirmed: ${hash}`),
  })
  if (!result.success) log(`Restore failed: ${result.error}`)
}

async function run() {
  try {
    await tick()
  } catch (err) {
    log(`Scan failed: ${err instanceof Error ? err.message : String(err)}`)
    if (ONCE) process.exitCode = 1
  }
  if (!ONCE) setTimeout(run, INTERVAL_MS)
}

run()
