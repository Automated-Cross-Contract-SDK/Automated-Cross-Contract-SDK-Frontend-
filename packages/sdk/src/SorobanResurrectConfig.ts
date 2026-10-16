import type { SorobanResurrectConfig } from './types.js'
import type { ISorobanRpcClient } from './RpcClient.js'
import { SorobanRpcClient } from './RpcClient.js'
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
  TTL_WATCH_THRESHOLD,
} from './constants.js'
import { SimulationCache } from './SimulationCache.js'

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

/** Configuration settings after defaults and validation, without an RPC client. */
export type EffectiveSorobanResurrectConfig = Required<Omit<SorobanResurrectConfig, 'rpcClient'>>

const ARCHIVE_DETECTION_METHODS = ['simulation', 'direct'] as const

/**
 * Validates a numeric config field and includes its public field name in errors.
 */
function validateNumber(
  field: string,
  value: unknown,
  minimum: number,
  exclusive: boolean,
  integer = false,
): void {
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (exclusive ? value > minimum : value >= minimum) &&
    (!integer || Number.isSafeInteger(value))
  if (!valid) {
    throw new Error(
      `Invalid config.${field}: expected a finite number ${exclusive ? 'greater than' : 'at least'} ${minimum}` +
        `${integer ? ' and a safe integer' : ''}; received ${JSON.stringify(value)}.`,
    )
  }
}

function validateFeeCap(value: unknown): void {
  const validNumber = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const validString = typeof value === 'string' && /^\d+$/.test(value)
  if (!validNumber && !validString) {
    throw new Error(
      `Invalid config.maxRestoreFeeStroops: expected a non-negative safe integer or decimal integer string; ` +
        `received ${JSON.stringify(value)}.`,
    )
  }
}

function validateInteger(field: string, value: unknown, minimum: number): void {
  validateNumber(field, value, minimum, false, true)
}

/**
 * Validates a config field expected to be a boolean.
 */
function validateBoolean(field: string, value: unknown): void {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid config.${field}: expected a boolean; received ${JSON.stringify(value)}.`)
  }
}

/** Default simulation-cache TTL (ms); matches `SimulationCache`'s built-in default. */
export const SIMULATION_CACHE_TTL_MS = 30_000
/** Default simulation-cache capacity; matches `SimulationCache`'s built-in default. */
export const SIMULATION_CACHE_MAX_SIZE = 50

/**
 * Validates the shape of the fields `resolveConfig` doesn't already default
 * or structurally guarantee — everything a caller could pass a nonsensical
 * value for. Throws a descriptive, field-prefixed `Error` on the first
 * problem found, rather than letting a bad value surface later as a cryptic
 * RPC or `TransactionBuilder` failure.
 *
 * This is the single validation implementation in the module: it is invoked
 * by both the constructor path (`resolveConfig`) and `switchNetwork()` so the
 * two entry points cannot drift apart.
 */
export function validateConfigShape(config: SorobanResurrectConfig): void {
  if (typeof config.rpcUrl !== 'string' || config.rpcUrl.length === 0) {
    throw new Error(`Invalid config.rpcUrl: expected a non-empty URL string; received ${JSON.stringify(config.rpcUrl)}.`)
  }
  if (config.networkPassphrase !== undefined &&
      (typeof config.networkPassphrase !== 'string' || config.networkPassphrase.length === 0)) {
    throw new Error(
      `Invalid config.networkPassphrase: expected a non-empty string; ` +
        `received ${JSON.stringify(config.networkPassphrase)}.`,
    )
  }
  let rpcUrl: URL
  try {
    rpcUrl = new URL(config.rpcUrl)
  } catch {
    throw new Error(`Invalid config.rpcUrl: expected an absolute HTTP(S) URL; received ${JSON.stringify(config.rpcUrl)}.`)
  }
  if (!['http:', 'https:'].includes(rpcUrl.protocol) || !rpcUrl.hostname) {
    throw new Error(
      `Invalid config.rpcUrl: expected an absolute HTTP(S) URL; received ${JSON.stringify(config.rpcUrl)}.`,
    )
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

  if (config.maxRestoreFeeStroops !== undefined) {
    validateFeeCap(config.maxRestoreFeeStroops)
  }

  if (config.rpcTimeoutMs !== undefined) {
    validateNumber('rpcTimeoutMs', config.rpcTimeoutMs, 0, true)
  }

  if (config.rpcRetryCount !== undefined) {
    validateInteger('rpcRetryCount', config.rpcRetryCount, 0)
  }

  if (config.rpcRetryBackoffMs !== undefined) {
    validateInteger('rpcRetryBackoffMs', config.rpcRetryBackoffMs, 0)
  }

  if (config.rpcCircuitBreakerThreshold !== undefined) {
    validateInteger('rpcCircuitBreakerThreshold', config.rpcCircuitBreakerThreshold, 1)
  }

  if (config.rpcCircuitBreakerCooldownMs !== undefined) {
    validateInteger('rpcCircuitBreakerCooldownMs', config.rpcCircuitBreakerCooldownMs, 0)
  }

  if (config.ttlWatchIntervalMs !== undefined) {
    validateNumber('ttlWatchIntervalMs', config.ttlWatchIntervalMs, 0, true)
  }

  if (config.ttlWatchThreshold !== undefined) {
    validateInteger('ttlWatchThreshold', config.ttlWatchThreshold, 0)
  }

  if (config.ttlWatchAutoExtend !== undefined) {
    validateBoolean('ttlWatchAutoExtend', config.ttlWatchAutoExtend)
  }

  if (config.maxSequenceRetries !== undefined) {
    validateInteger('maxSequenceRetries', config.maxSequenceRetries, 0)
  }

  if (config.archiveDetectionChunkSize !== undefined) {
    validateInteger('archiveDetectionChunkSize', config.archiveDetectionChunkSize, 1)
  }

  if (config.archiveDetectionConcurrency !== undefined) {
    validateInteger('archiveDetectionConcurrency', config.archiveDetectionConcurrency, 1)
  }

  if (
    config.archiveDetectionMethod !== undefined &&
    !ARCHIVE_DETECTION_METHODS.includes(config.archiveDetectionMethod)
  ) {
    throw new Error(
      `Invalid config.archiveDetectionMethod: ${JSON.stringify(config.archiveDetectionMethod)}. ` +
        `Must be one of: ${ARCHIVE_DETECTION_METHODS.map((m) => `"${m}"`).join(', ')}.`,
    )
  }

  if (config.archiveDetectionFallback !== undefined) {
    validateBoolean('archiveDetectionFallback', config.archiveDetectionFallback)
  }

  if (config.archiveDetectionMethod === 'direct' && config.archiveDetectionFallback !== undefined) {
    throw new Error(
      'Invalid config.archiveDetectionFallback: this option only applies when ' +
        'archiveDetectionMethod is "simulation".',
    )
  }

  if (config.useSSE !== undefined) {
    validateBoolean('useSSE', config.useSSE)
  }

  if (config.enableSimulationCache !== undefined) {
    validateBoolean('enableSimulationCache', config.enableSimulationCache)
  }

  if (config.simulationCacheTtlMs !== undefined) {
    validateNumber('simulationCacheTtlMs', config.simulationCacheTtlMs, 0, true)
  }

  if (config.simulationCacheMaxSize !== undefined) {
    if (!Number.isSafeInteger(config.simulationCacheMaxSize) || config.simulationCacheMaxSize < 1) {
      throw new Error(
        `Invalid config.simulationCacheMaxSize: expected a positive safe integer; ` +
          `received ${JSON.stringify(config.simulationCacheMaxSize)}.`,
      )
    }
  }

  if (config.restoreTxMemoText !== undefined && typeof config.restoreTxMemoText !== 'string') {
    throw new Error(
      `Invalid config.restoreTxMemoText: expected a string; received ${JSON.stringify(config.restoreTxMemoText)}.`,
    )
  }
}

/**
 * Validates and resolves a partial `SorobanResurrectConfig` into a fully
 * typed `ResolvedConfig`.
 *
 * Resolution rules:
 * - `rpcUrl` must be a non-empty, well-formed URL.
 * - `pollIntervalMs`, `pollTimeoutMs` (if given) must be finite and > 0;
 *   `restoreFeeMultiplier` (if given) must be finite and >= 1.
 * - `archiveDetectionMethod` (if given) must be `'simulation'` or `'direct'`;
 *   `useSSE` and `enableSimulationCache` (if given) must be actual booleans —
 *   a truthy non-boolean (e.g. the string `"false"`) is rejected rather than
 *   silently coerced, since that has bitten callers passing config through
 *   from parsed JSON or env vars.
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
  const effectiveConfig = resolveEffectiveSettings(config)
  const server = config.rpcClient ?? new SorobanRpcClient(config.rpcUrl)

  // A fresh cache is built on every resolve, so switchNetwork() never reuses
  // stale entries. Keep the TTL short relative to the ledger close time
  // (~5s): a replayed cached restore response can report "restore needed"
  // after the entry was already restored (or miss a newly archived entry),
  // which at worst causes a redundant restore or a failed submission.
  const simulationCache = effectiveConfig.enableSimulationCache
    ? new SimulationCache({
        ttlMs: effectiveConfig.simulationCacheTtlMs,
        maxSize: effectiveConfig.simulationCacheMaxSize,
      })
    : undefined

  const resolved = { ...effectiveConfig, rpcClient: server }

  return { server, config: resolved, simulationCache }
}

/**
 * Returns a fresh, validated configuration snapshot with SDK defaults applied.
 * Unlike {@link resolveConfig}, this helper does not construct an RPC client
 * or simulation cache, so it can be used to display or log effective settings.
 */
export function getEffectiveConfig(config: SorobanResurrectConfig): EffectiveSorobanResurrectConfig {
  return Object.freeze({ ...resolveEffectiveSettings(config) })
}

function resolveEffectiveSettings(config: SorobanResurrectConfig): EffectiveSorobanResurrectConfig {
  validateConfigShape(config)

  const networkPassphrase =
    config.networkPassphrase ??
    resolveNetworkPassphrase(config.rpcUrl) ??
    DEFAULT_NETWORK_PASSPHRASE

  if (!KNOWN_NETWORK_PASSPHRASES.includes(networkPassphrase)) {
    const knownNetworks = KNOWN_NETWORK_PASSPHRASES.map((p) => `"${p}"`).join(', ')
    throw new Error(
      `Invalid config.networkPassphrase: "${networkPassphrase}". ` +
        `Must be one of: ${knownNetworks}. ` +
        `A typo in the passphrase will cause cryptic transaction failures.`,
    )
  }

  return {
    rpcUrl: config.rpcUrl,
    networkPassphrase,
    pollIntervalMs: config.pollIntervalMs ?? POLL_INTERVAL_MS,
    pollTimeoutMs: config.pollTimeoutMs ?? POLL_TIMEOUT_MS,
    restoreFeeMultiplier: config.restoreFeeMultiplier ?? RESTORE_FEE_MULTIPLIER,
    rpcTimeoutMs: config.rpcTimeoutMs ?? RPC_TIMEOUT_MS,
    rpcRetryCount: config.rpcRetryCount ?? RPC_RETRY_COUNT,
    rpcRetryBackoffMs: config.rpcRetryBackoffMs ?? RPC_RETRY_BACKOFF_MS,
    rpcCircuitBreakerThreshold: config.rpcCircuitBreakerThreshold ?? RPC_CIRCUIT_BREAKER_THRESHOLD,
    rpcCircuitBreakerCooldownMs: config.rpcCircuitBreakerCooldownMs ?? RPC_CIRCUIT_BREAKER_COOLDOWN_MS,
    ttlWatchIntervalMs: config.ttlWatchIntervalMs ?? TTL_WATCH_INTERVAL_MS,
    ttlWatchThreshold: config.ttlWatchThreshold ?? TTL_WATCH_THRESHOLD,
    archiveDetectionMethod: config.archiveDetectionMethod ?? 'simulation',
    useSSE: config.useSSE ?? false,
    enableSimulationCache: config.enableSimulationCache ?? false,
    simulationCacheTtlMs: config.simulationCacheTtlMs ?? SIMULATION_CACHE_TTL_MS,
    simulationCacheMaxSize: config.simulationCacheMaxSize ?? SIMULATION_CACHE_MAX_SIZE,
  }
}
