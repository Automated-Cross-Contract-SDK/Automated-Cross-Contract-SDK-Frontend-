import defaults from './config/defaults.json' with { type: 'json' }

export type { SdkDefaults }

/**
 * Shape of the defaults.json configuration file.
 * All values here can be overridden at runtime via SorobanResurrectConfig.
 */
interface SdkDefaults {
  defaultNetworkPassphrase: string
  defaultRpcUrl: string
  pollIntervalMs: number
  pollTimeoutMs: number
  restoreFeeMultiplier: number
  knownNetworkPassphrases: string[]
  urlToPassphrase: Record<string, string>
}

/**
 * The raw defaults object loaded from `src/config/defaults.json`.
 * Consumers can import this to inspect or extend SDK defaults.
 *
 * @example
 * ```ts
 * import { SDK_DEFAULTS } from '@soroban-resurrect/sdk'
 * console.log(SDK_DEFAULTS.pollIntervalMs) // 1000
 * ```
 */
export const SDK_DEFAULTS: SdkDefaults = defaults

/** Default network passphrase for the Soroban Testnet. */
export const DEFAULT_NETWORK_PASSPHRASE: string = defaults.defaultNetworkPassphrase

/** Default Soroban RPC URL (Testnet). */
export const DEFAULT_RPC_URL: string = defaults.defaultRpcUrl

/** Default interval (ms) for polling transaction status. */
export const POLL_INTERVAL_MS: number = defaults.pollIntervalMs

/** Default timeout (ms) for polling transaction status. */
export const POLL_TIMEOUT_MS: number = defaults.pollTimeoutMs

/**
 * Default multiplier applied to minResourceFee when building a restore transaction.
 *
 * A multiplier of 3x is a reasonable balance: high enough to ensure successful
 * inclusion during network congestion, but not so excessive that users pay 3-5x
 * more than necessary. Can be customized via SorobanResurrectConfig.restoreFeeMultiplier.
 */
export const RESTORE_FEE_MULTIPLIER: number = defaults.restoreFeeMultiplier

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

/**
 * Maximum serialized transaction (envelope) size accepted by Soroban, in bytes.
 *
 * Soroban caps the total transaction size at 128 KiB. A `restoreFootprint`
 * operation whose footprint contains many ledger keys can approach this limit
 * and be rejected by the network *after* the wallet has already signed it.
 *
 * @see https://developers.stellar.org/docs/networks/resource-limits-fees
 */
export const SOROBAN_MAX_TX_XDR_BYTES = 128 * 1024

/**
 * Fraction of {@link SOROBAN_MAX_TX_XDR_BYTES} at which a restore transaction is
 * considered "approaching the limit" and a warning is emitted. Override via
 * `SorobanResurrectConfig.restoreSizeWarnRatio`.
 */
export const RESTORE_TX_SIZE_WARN_RATIO = 0.8

/**
 * Default number of times to rebuild-and-resubmit the original transaction
 * after a `tx_bad_seq` rejection before giving up. The account can be bumped
 * by another client (or by the restore transaction itself, on some RPC
 * timing) between rebuilding the original tx and its submission; each retry
 * fetches a fresh sequence number, so this bounds how many times that race
 * can be re-run rather than surfacing as a hard failure. Configurable via
 * `SorobanResurrectConfig.maxSequenceRetries`.
 */
export const MAX_SEQUENCE_RETRIES = 3

/** Alias of {@link MAX_SEQUENCE_RETRIES} (name used by the execution layer). */
export const DEFAULT_MAX_SEQUENCE_RETRIES = MAX_SEQUENCE_RETRIES

/** Per-call RPC timeout (ms) applied by the resilient transport. */
export const RPC_TIMEOUT_MS = 10_000

/** Number of RPC retries beyond the initial attempt for transient failures. */
export const RPC_RETRY_COUNT = 2

/** Base backoff (ms) between RPC retries; doubles per attempt with jitter. */
export const RPC_RETRY_BACKOFF_MS = 250

/** Consecutive RPC failures before the circuit breaker trips. */
export const RPC_CIRCUIT_BREAKER_THRESHOLD = 5

/** Cooldown (ms) the circuit breaker stays open before half-opening again. */
export const RPC_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000

/** Default polling cadence (ms) for `watchTTL()` when a call doesn't override it. */
export const TTL_WATCH_INTERVAL_MS = 60_000

/**
 * Default "expiring soon" threshold (in remaining ledgers) for `watchTTL()`
 * when a call doesn't override it — ~24 h at the nominal 5 s ledger close.
 */
export const TTL_WATCH_THRESHOLD_LEDGERS = 17_280

/** Whether `watchTTL()` submits a restore automatically by default (observe-only). */
export const TTL_WATCH_AUTO_EXTEND = false

/** Known Stellar/Soroban network passphrases for validation. */
export const KNOWN_NETWORK_PASSPHRASES = [
  'Test SDF Network ; September 2015', // Testnet
  'Public Global Stellar Network ; September 2015', // Mainnet
  'Test SDF Future Network ; October 2022', // Futurenet
]

// ---------------------------------------------------------------------------
// Network presets (re-exported by SorobanResurrectNetwork.ts)
// ---------------------------------------------------------------------------

/** Well-known Soroban network names understood by `SorobanResurrectNetwork`. */
export type SorobanNetworkName = 'testnet' | 'mainnet' | 'futurenet'

/** RPC URL + passphrase pair for a well-known Soroban network. */
export interface SorobanNetworkPreset {
  /** Soroban RPC endpoint for the network. */
  rpcUrl: string
  /** Network passphrase identifying the network cryptographically. */
  networkPassphrase: string
}

/** Presets for the well-known Stellar/Soroban networks. */
export const NETWORK_PRESETS: Record<SorobanNetworkName, SorobanNetworkPreset> = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  },
  mainnet: {
    rpcUrl: 'https://soroban-mainnet.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  },
  futurenet: {
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
  },
}

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
