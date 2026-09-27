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

/**
 * Default number of ledger keys fetched per `getLedgerEntries` request when
 * detecting archived entries. Configurable via
 * `SorobanResurrectConfig.archiveDetectionChunkSize`.
 */
export const ARCHIVE_DETECTION_CHUNK_SIZE = LEDGER_ENTRY_CHUNK_SIZE

/**
 * Default number of archive-detection chunk requests kept in flight at once.
 * Configurable via `SorobanResurrectConfig.archiveDetectionConcurrency`.
 */
export const ARCHIVE_DETECTION_CONCURRENCY = LEDGER_ENTRY_CONCURRENCY

/**
 * Default upper bound (in stroops) on the total fee a restore transaction may
 * pay. Restores above this bound are rejected before signing. Configurable via
 * `SorobanResurrectConfig.maxRestoreFeeStroops`.
 */
export const MAX_RESTORE_FEE_STROOPS = 10_000_000

/** Default timeout (ms) for a single RPC request. */
export const RPC_TIMEOUT_MS = 30_000

/** Default number of times an RPC request is retried on transient failure. */
export const RPC_RETRY_COUNT = 3

/** Default base backoff (ms) between RPC retries. */
export const RPC_RETRY_BACKOFF_MS = 500

/**
 * Default number of consecutive RPC failures that trips the circuit breaker.
 */
export const RPC_CIRCUIT_BREAKER_THRESHOLD = 5

/**
 * Default cooldown (ms) before the circuit breaker allows requests again.
 */
export const RPC_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000

/** Default interval (ms) between TTL watch sweeps. */
export const TTL_WATCH_INTERVAL_MS = 60_000

/**
 * Default remaining-TTL threshold (in ledgers) below which the TTL watcher
 * considers an entry at risk and triggers an extension.
 */
export const TTL_WATCH_THRESHOLD = 100

/**
 * Whether the TTL watcher automatically extends entries that fall below
 * {@link TTL_WATCH_THRESHOLD}. Configurable via
 * `SorobanResurrectConfig.ttlWatchAutoExtend`.
 */
export const TTL_WATCH_AUTO_EXTEND = false

/** Default memo type attached to restore transactions. */
export const RESTORE_TX_MEMO = 'none'

/** Default memo text attached to restore transactions when memo is `text`. */
export const RESTORE_TX_MEMO_TEXT = ''

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
