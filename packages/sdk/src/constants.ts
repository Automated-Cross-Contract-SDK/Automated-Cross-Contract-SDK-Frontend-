/** Default network passphrase for the Soroban Testnet. */
export const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'

/** Default Soroban RPC URL (Testnet). */
export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org'

/** Default interval (ms) for polling transaction status. */
export const POLL_INTERVAL_MS = 1000

/** Default timeout (ms) for polling transaction status. */
export const POLL_TIMEOUT_MS = 60_000

/**
 * Default multiplier applied to minResourceFee when building a restore transaction.
 *
 * A multiplier of 3x is a reasonable balance: high enough to ensure successful
 * inclusion during network congestion, but not so excessive that users pay 3-5x
 * more than necessary. Can be customized via SorobanResurrectConfig.restoreFeeMultiplier.
 */
export const RESTORE_FEE_MULTIPLIER = 3

/**
 * Number of ledger keys sent in a single `getLedgerEntries` request.
 *
 * The RPC server caps how many keys one request may carry, so large footprints
 * are split into chunks of this size.
 */
export const LEDGER_ENTRY_CHUNK_SIZE = 50

/**
 * Number of `getLedgerEntries` chunk requests kept in flight at once.
 *
 * Large footprints are dominated by RPC round-trip latency, so chunks are
 * issued in parallel. The default is deliberately modest — public RPC
 * endpoints rate-limit aggressively, and a rate-limited chunk is treated as
 * archived, which would cause needless restores.
 */
export const LEDGER_ENTRY_CONCURRENCY = 4

/** Known Stellar/Soroban network passphrases for validation. */
export const KNOWN_NETWORK_PASSPHRASES = [
  'Test SDF Network ; September 2015', // Testnet
  'Public Global Stellar Network ; September 2015', // Mainnet
  'Test SDF Future Network ; October 2022', // Futurenet
]

/** Known Soroban RPC URL to passphrase mapping for common endpoints. */
export const URL_TO_PASSPHRASE: Record<string, string> = {
  'soroban-testnet.stellar.org': 'Test SDF Network ; September 2015',
  'soroban-mainnet.stellar.org': 'Public Global Stellar Network ; September 2015',
  'futurenet.stellar.org': 'Test SDF Future Network ; September 2015',
  localhost: 'Test SDF Network ; September 2015',
}

/**
 * Maps common RPC URLs to their network passphrases.
 * Users can extend this to add custom RPC endpoints.
 */
export function resolveNetworkPassphrase(rpcUrl: string): string | undefined {
  try {
    const host = new URL(rpcUrl).hostname
    return URL_TO_PASSPHRASE[host]
  } catch {
    return undefined
  }
}
