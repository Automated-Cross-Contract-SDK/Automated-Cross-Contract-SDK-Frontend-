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

/** Default per-call timeout (ms) for RPC calls made through the resilient transport. */
export const RPC_TIMEOUT_MS = 10_000

/** Default number of retries (in addition to the initial attempt) for transient RPC failures. */
export const RPC_RETRY_COUNT = 2

/** Default base backoff (ms) between RPC retries (doubles each attempt, plus jitter). */
export const RPC_RETRY_BACKOFF_MS = 250

/** Default number of consecutive RPC failures before the circuit breaker trips. */
export const RPC_CIRCUIT_BREAKER_THRESHOLD = 5

/** Default cooldown (ms) the circuit breaker stays open before allowing calls through again. */
export const RPC_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000

/** Well-known Stellar/Soroban network identifiers. */
export type SorobanNetworkName = 'testnet' | 'mainnet' | 'futurenet'

/** Pre-configured RPC URL and network passphrase for a well-known network. */
export interface SorobanNetworkPreset {
  /** Soroban JSON-RPC endpoint URL. */
  rpcUrl: string
  /** Network passphrase used when signing and submitting transactions. */
  networkPassphrase: string
  /** Human-readable display name. */
  displayName: string
}

/**
 * Pre-configured network presets for well-known Stellar/Soroban networks.
 * Each entry contains the canonical RPC URL and network passphrase.
 */
export const NETWORK_PRESETS: Record<SorobanNetworkName, SorobanNetworkPreset> = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    displayName: 'Testnet',
  },
  mainnet: {
    rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/XCSmR1pP5PR9HBMcUxnHEHaZiVlFpF8A',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    displayName: 'Mainnet',
  },
  futurenet: {
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    networkPassphrase: 'Test SDF Future Network ; September 2015',
    displayName: 'Futurenet',
  },
}

/** Known Stellar/Soroban network passphrases for validation. */
export const KNOWN_NETWORK_PASSPHRASES = [
  'Test SDF Network ; September 2015',        // Testnet
  'Public Global Stellar Network ; September 2015', // Mainnet
  'Test SDF Future Network ; October 2022', // Futurenet
]

/** Known Soroban RPC URL to passphrase mapping for common endpoints. */
export const URL_TO_PASSPHRASE: Record<string, string> = {
  'soroban-testnet.stellar.org': 'Test SDF Network ; September 2015',
  'soroban-mainnet.stellar.org': 'Public Global Stellar Network ; September 2015',
  'futurenet.stellar.org': 'Test SDF Future Network ; September 2015',
  'localhost': 'Test SDF Network ; September 2015',
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
