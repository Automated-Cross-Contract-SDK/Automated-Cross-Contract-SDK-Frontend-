import { rpc } from '@stellar/stellar-sdk'
import { SorobanResurrectConfig } from './types.js'
import {
  DEFAULT_NETWORK_PASSPHRASE,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  RESTORE_FEE_MULTIPLIER,
  KNOWN_NETWORK_PASSPHRASES,
  resolveNetworkPassphrase,
} from './constants.js'
import { SimulationCache } from './SimulationCache.js'

/**
 * Result of initialising the SDK configuration.
 *
 * Contains the fully resolved `Required<SorobanResurrectConfig>`, the
 * constructed `rpc.Server`, and an optional `SimulationCache` instance
 * (present only when `enableSimulationCache` is `true`).
 */
export interface ResolvedConfig {
  /** Soroban RPC server instance bound to the configured endpoint. */
  server: rpc.Server
  /** Resolved configuration with all optional fields filled in. */
  config: Required<SorobanResurrectConfig>
  /**
   * Cache for simulation responses. Only present when
   * `config.enableSimulationCache` is `true`; `undefined` otherwise.
   */
  simulationCache: SimulationCache | undefined
}

/**
 * Validates and resolves a partial `SorobanResurrectConfig` into a fully
 * typed `ResolvedConfig`.
 *
 * Resolution rules:
 * - `networkPassphrase` falls back to `resolveNetworkPassphrase(rpcUrl)`,
 *   then to `DEFAULT_NETWORK_PASSPHRASE`.
 * - All numeric / boolean fields fall back to their SDK defaults.
 * - Throws with a descriptive message if the resolved passphrase is not
 *   among the `KNOWN_NETWORK_PASSPHRASES`, since an incorrect passphrase
 *   causes cryptic transaction failures.
 * - Creates a `SimulationCache` instance when `enableSimulationCache` is
 *   `true`.
 *
 * @param config - Raw SDK configuration supplied by the caller.
 * @returns A `ResolvedConfig` ready to be used by the `SorobanResurrect` facade.
 * @throws {Error} If the resolved `networkPassphrase` is not a known passphrase.
 *
 * @example
 * ```ts
 * const resolved = resolveConfig({ rpcUrl: 'https://soroban-testnet.stellar.org' })
 * // resolved.config.networkPassphrase === 'Test SDF Network ; September 2015'
 * ```
 */
export function resolveConfig(config: SorobanResurrectConfig): ResolvedConfig {
  const server = new rpc.Server(config.rpcUrl)

  const networkPassphrase =
    config.networkPassphrase ??
    resolveNetworkPassphrase(config.rpcUrl) ??
    DEFAULT_NETWORK_PASSPHRASE

  if (!KNOWN_NETWORK_PASSPHRASES.includes(networkPassphrase)) {
    const knownNetworks = KNOWN_NETWORK_PASSPHRASES.map((p) => `"${p}"`).join(', ')
    throw new Error(
      `Invalid network passphrase: "${networkPassphrase}". ` +
        `Must be one of: ${knownNetworks}. ` +
        `A typo in the passphrase will cause cryptic transaction failures.`,
    )
  }

  const simulationCache = config.enableSimulationCache ? new SimulationCache() : undefined

  const resolved: Required<SorobanResurrectConfig> = {
    rpcUrl: config.rpcUrl,
    networkPassphrase,
    pollIntervalMs: config.pollIntervalMs ?? POLL_INTERVAL_MS,
    pollTimeoutMs: config.pollTimeoutMs ?? POLL_TIMEOUT_MS,
    restoreFeeMultiplier: config.restoreFeeMultiplier ?? RESTORE_FEE_MULTIPLIER,
    archiveDetectionMethod: config.archiveDetectionMethod ?? 'simulation',
    enableSimulationCache: config.enableSimulationCache ?? false,
    useSSE: config.useSSE ?? false,
    // Restore-tx memo passthrough: preserved as-is; `undefined`/`''` means "no memo".
    restoreTxMemo: config.restoreTxMemo,
    restoreTxMemoText: config.restoreTxMemoText ?? '',
  } as Required<SorobanResurrectConfig>

  return { server, config: resolved, simulationCache }
}
