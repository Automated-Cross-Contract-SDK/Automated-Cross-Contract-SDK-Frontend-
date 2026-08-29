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

/** Known Stellar/Soroban network passphrases for validation. */
export const KNOWN_NETWORK_PASSPHRASES: string[] = defaults.knownNetworkPassphrases

/** Known Soroban RPC URL to passphrase mapping for common endpoints. */
export const URL_TO_PASSPHRASE: Record<string, string> = defaults.urlToPassphrase

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
