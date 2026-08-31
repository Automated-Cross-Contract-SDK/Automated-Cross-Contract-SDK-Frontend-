import { SorobanResurrectConfig } from './types.js'
import {
  DEFAULT_NETWORK_PASSPHRASE,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  RESTORE_FEE_MULTIPLIER,
  RPC_TIMEOUT_MS,
  RPC_RETRY_COUNT,
  RPC_RETRY_BACKOFF_MS,
  RPC_CIRCUIT_BREAKER_THRESHOLD,
  RPC_CIRCUIT_BREAKER_COOLDOWN_MS,
  KNOWN_NETWORK_PASSPHRASES,
  resolveNetworkPassphrase,
  TTL_WATCH_INTERVAL_MS,
  TTL_WATCH_THRESHOLD_LEDGERS,
} from './constants.js'
import { SimulationCache } from './SimulationCache.js'
import { SorobanRpcClient, type ISorobanRpcClient } from './RpcClient.js'

/**
 * Result of initialising the SDK configuration.
 *
 * Contains the fully resolved `Required<SorobanResurrectConfig>`, the
 * constructed RPC client, and an optional `SimulationCache` instance
 * (present only when `enableSimulationCache` is `true`).
 */
export interface ResolvedConfig {
  /**
   * RPC client bound to the configured endpoint. This is `config.rpcClient`
   * when supplied, otherwise a {@link SorobanRpcClient} created from
   * `config.rpcUrl`.
   */
  server: ISorobanRpcClient
  /** Resolved configuration with all optional fields filled in. */
  config: Required<Omit<SorobanResurrectConfig, 'rpcClient'>> & { rpcClient: ISorobanRpcClient }
  /**
   * Cache for simulation responses. Only present when
   * `config.enableSimulationCache` is `true`; `undefined` otherwise.
   */
  simulationCache: SimulationCache | undefined
}

const ARCHIVE_DETECTION_METHODS = ['simulation', 'direct'] as const

/**
 * Validates a numeric config field, throwing a descriptive error if it is
 * not a finite number or falls outside the allowed range.
 */
function validateNumber(field: string, value: unknown, minimum: number, exclusive: boolean): void {
  const valid = typeof value === 'number' && Number.isFinite(value) && (exclusive ? value > minimum : value >= minimum)
  if (!valid) {
    throw new Error(
      `Invalid ${field}: ${JSON.stringify(value)}. Must be a finite number ${exclusive ? '>' : '>='} ${minimum}.`,
    )
  }
}

/**
 * Validates a config field expected to be a boolean.
 */
function validateBoolean(field: string, value: unknown): void {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${field}: ${JSON.stringify(value)}. Must be a boolean.`)
  }
}

/**
 * Validates and resolves a partial `SorobanResurrectConfig` into a fully
 * typed `ResolvedConfig`.
 *
 * Resolution rules:
 * - `networkPassphrase` falls back to `resolveNetworkPassphrase(rpcUrl)`,
 *   then to `DEFAULT_NETWORK_PASSPHRASE`.
 * - All numeric / boolean fields fall back to their SDK defaults.
 * - Throws with a descriptive message if any field is missing/malformed,
 *   or if the resolved passphrase is not among the
 *   `KNOWN_NETWORK_PASSPHRASES`, since an incorrect passphrase causes
 *   cryptic transaction failures.
 * - Creates a `SimulationCache` instance when `enableSimulationCache` is
 *   `true`.
 *
 * @param config - Raw SDK configuration supplied by the caller.
 * @returns A `ResolvedConfig` ready to be used by the `SorobanResurrect` facade.
 * @throws {Error} If any config field is invalid, or the resolved
 *   `networkPassphrase` is not a known passphrase.
 *
 * @example
 * ```ts
 * const resolved = resolveConfig({ rpcUrl: 'https://soroban-testnet.stellar.org' })
 * // resolved.config.networkPassphrase === 'Test SDF Network ; September 2015'
 * ```
 */
export function resolveConfig(config: SorobanResurrectConfig): ResolvedConfig {
  if (typeof config.rpcUrl !== 'string' || config.rpcUrl.length === 0) {
    throw new Error(`Invalid rpcUrl: ${JSON.stringify(config.rpcUrl)}. Must be a non-empty string.`)
  }

  if (config.pollIntervalMs !== undefined) {
    validateNumber('pollIntervalMs', config.pollIntervalMs, 0, true)
  }

  if (config.pollTimeoutMs !== undefined) {
    validateNumber('pollTimeoutMs', config.pollTimeoutMs, 0, true)
  }

  if (config.restoreFeeMultiplier !== undefined) {
    validateNumber('restoreFeeMultiplier', config.restoreFeeMultiplier, 1, false)
  }

  if (
    config.archiveDetectionMethod !== undefined &&
    !ARCHIVE_DETECTION_METHODS.includes(config.archiveDetectionMethod)
  ) {
    throw new Error(
      `Invalid archiveDetectionMethod: ${JSON.stringify(config.archiveDetectionMethod)}. ` +
        `Must be one of: ${ARCHIVE_DETECTION_METHODS.map((m) => `"${m}"`).join(', ')}.`,
    )
  }

  if (config.useSSE !== undefined) {
    validateBoolean('useSSE', config.useSSE)
  }

  if (config.enableSimulationCache !== undefined) {
    validateBoolean('enableSimulationCache', config.enableSimulationCache)
  }

  const server = config.rpcClient ?? new SorobanRpcClient(config.rpcUrl)

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

  const resolved: Required<Omit<SorobanResurrectConfig, 'rpcClient'>> & { rpcClient: ISorobanRpcClient } = {
    rpcUrl: config.rpcUrl,
    networkPassphrase,
    pollIntervalMs: config.pollIntervalMs ?? POLL_INTERVAL_MS,
    pollTimeoutMs: config.pollTimeoutMs ?? POLL_TIMEOUT_MS,
    restoreFeeMultiplier: config.restoreFeeMultiplier ?? RESTORE_FEE_MULTIPLIER,
    archiveDetectionMethod: config.archiveDetectionMethod ?? 'simulation',
    archiveDetectionFallback: config.archiveDetectionFallback ?? true,
    enableSimulationCache: config.enableSimulationCache ?? false,
    useSSE: config.useSSE ?? false,
    rpcClient: server,
  }

  return { server, config: resolved, simulationCache }
}
