/**
 * @file RpcClient.ts
 *
 * RPC abstraction layer for the Soroban-Resurrect SDK.
 *
 * ## Why an abstraction layer?
 *
 * All Soroban RPC interactions previously flowed directly through `rpc.Server`
 * from `@stellar/stellar-sdk`. While this works at runtime, it makes the SDK
 * harder to test because:
 *
 * 1. `rpc.Server` is a concrete class with no built-in interface — tests must
 *    cast partial mock objects (`{} as unknown as rpc.Server`) to satisfy TypeScript.
 * 2. Swapping the underlying transport (e.g. injecting a caching proxy, a
 *    rate-limiter, or a test double) requires replacing the entire `rpc.Server`
 *    instance with a cast.
 * 3. Type-checking for mock objects is opt-in rather than enforced — a mock can
 *    silently omit a method that the code under test will eventually call.
 *
 * This module introduces {@link ISorobanRpcClient} — a minimal TypeScript
 * interface covering exactly the six `rpc.Server` methods used by this SDK.
 * Any object that implements the interface (including the bundled
 * {@link SorobanRpcClient} wrapper and hand-written test doubles) can be
 * injected wherever the SDK previously expected `rpc.Server`.
 *
 * ## Usage
 *
 * ### Production (default)
 * Pass a `rpcUrl` string to `SorobanResurrect` — it creates a
 * `SorobanRpcClient` internally, exactly as before:
 *
 * ```ts
 * const sdk = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })
 * ```
 *
 * ### Dependency injection (advanced / testing)
 * Build your own client and pass it directly:
 *
 * ```ts
 * import { createRpcClient } from '@soroban-resurrect/sdk'
 *
 * const client = createRpcClient('https://soroban-testnet.stellar.org')
 * const sdk = new SorobanResurrect({ rpcUrl: '...', rpcClient: client })
 * ```
 *
 * ### Test doubles
 * Implement `ISorobanRpcClient` directly — TypeScript will enforce that all
 * required methods are present:
 *
 * ```ts
 * import type { ISorobanRpcClient } from '@soroban-resurrect/sdk'
 *
 * const mockClient: ISorobanRpcClient = {
 *   simulateTransaction: vi.fn(),
 *   sendTransaction:     vi.fn(),
 *   getTransaction:      vi.fn(),
 *   getAccount:          vi.fn(),
 *   getLedgerEntries:    vi.fn(),
 *   getLatestLedger:     vi.fn(),
 * }
 * ```
 */

import { rpc, Transaction, Account, xdr } from '@stellar/stellar-sdk'
import {
  RPC_TIMEOUT_MS,
  RPC_RETRY_COUNT,
  RPC_RETRY_BACKOFF_MS,
  RPC_CIRCUIT_BREAKER_THRESHOLD,
  RPC_CIRCUIT_BREAKER_COOLDOWN_MS,
} from './constants.js'

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Minimal interface covering every Soroban RPC method used by this SDK.
 *
 * Implement this interface to inject custom transports, caching proxies,
 * or test doubles without depending on the concrete `rpc.Server` class.
 *
 * The method signatures mirror `rpc.Server` exactly so that a real
 * {@link SorobanRpcClient} (which wraps `rpc.Server`) satisfies the
 * interface without any extra casting.
 */
export interface ISorobanRpcClient {
  /**
   * Simulates a transaction on the Soroban RPC endpoint.
   * Returns a success, error, or restore-required response.
   */
  simulateTransaction(
    transaction: Transaction,
  ): Promise<rpc.Api.SimulateTransactionResponse>

  /**
   * Submits a signed transaction (regular or fee-bump) to the network.
   * Returns the initial submission response, including the transaction hash.
   */
  sendTransaction(
    transaction: Transaction | import('@stellar/stellar-sdk').FeeBumpTransaction,
  ): Promise<rpc.Api.SendTransactionResponse>

  /**
   * Queries the status of a transaction by its hash.
   * Used for polling until the transaction reaches a terminal state.
   */
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>

  /**
   * Fetches the on-chain account record for the given public key.
   * Used to obtain the current sequence number before building transactions.
   */
  getAccount(publicKey: string): Promise<Account>

  /**
   * Fetches one or more ledger entries by their XDR keys.
   * Used to check whether ledger entries are archived (missing) or live.
   */
  getLedgerEntries(
    ...keys: xdr.LedgerKey[]
  ): Promise<rpc.Api.GetLedgerEntriesResponse>

  /**
   * Returns the latest ledger sequence number and its close time.
   * Used as the starting point for TTL calculations and SSE streaming.
   */
  getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse>
}

// ---------------------------------------------------------------------------
// Concrete implementation
// ---------------------------------------------------------------------------

/**
 * Production implementation of {@link ISorobanRpcClient} that delegates
 * every call to an underlying `rpc.Server` instance from
 * `@stellar/stellar-sdk`.
 *
 * This is a thin, transparent wrapper — it adds no logic of its own beyond
 * forwarding calls. Its purpose is to make the underlying `rpc.Server`
 * injectable via the {@link ISorobanRpcClient} interface, enabling
 * consumers to substitute test doubles or custom transports without
 * the `as unknown as rpc.Server` cast pattern.
 *
 * @example
 * ```ts
 * const client = new SorobanRpcClient('https://soroban-testnet.stellar.org')
 * // client satisfies ISorobanRpcClient
 * ```
 */
export class SorobanRpcClient implements ISorobanRpcClient {
  /**
   * The underlying `rpc.Server` instance.
   * Exposed for advanced use-cases that need direct access to methods
   * not covered by the {@link ISorobanRpcClient} interface (e.g. `getEvents`).
   */
  public readonly _server: rpc.Server

  /**
   * The RPC endpoint URL this client was constructed with.
   * Stored for reference (e.g. SSE URL construction in Restorer.ts).
   */
  public readonly serverURL: string

  /**
   * Creates a new client bound to the given Soroban RPC endpoint.
   *
   * @param rpcUrl - The full URL of the Soroban RPC endpoint.
   *   Example: `"https://soroban-testnet.stellar.org"`
   */
  constructor(rpcUrl: string) {
    this._server = new rpc.Server(rpcUrl)
    this.serverURL = rpcUrl
  }

  simulateTransaction(
    transaction: Transaction,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    return this._server.simulateTransaction(transaction)
  }

  sendTransaction(
    transaction: Transaction | import('@stellar/stellar-sdk').FeeBumpTransaction,
  ): Promise<rpc.Api.SendTransactionResponse> {
    return this._server.sendTransaction(transaction)
  }

  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    return this._server.getTransaction(hash)
  }

  getAccount(publicKey: string): Promise<Account> {
    return this._server.getAccount(publicKey)
  }

  getLedgerEntries(
    ...keys: xdr.LedgerKey[]
  ): Promise<rpc.Api.GetLedgerEntriesResponse> {
    return this._server.getLedgerEntries(...keys)
  }

  getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse> {
    return this._server.getLatestLedger()
  }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Creates a new {@link SorobanRpcClient} bound to the given RPC URL.
 *
 * This is the recommended way to create a client when you want to inject
 * it into the SDK rather than letting the SDK create it internally.
 *
 * @param rpcUrl - The full URL of the Soroban RPC endpoint.
 * @returns A {@link SorobanRpcClient} that satisfies {@link ISorobanRpcClient}.
 *
 * @example
 * ```ts
 * import { createRpcClient, SorobanResurrect } from '@soroban-resurrect/sdk'
 *
 * const client = createRpcClient('https://soroban-testnet.stellar.org')
 * // Inject the client (e.g. to wrap it with caching or logging first):
 * const sdk = new SorobanResurrect({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   rpcClient: client,
 * })
 * ```
 */
export function createRpcClient(rpcUrl: string): SorobanRpcClient {
  return new SorobanRpcClient(rpcUrl)
}

// ---------------------------------------------------------------------------
// Resilient transport (timeout + retry with backoff + circuit breaker)
// ---------------------------------------------------------------------------

/** Configuration for the resilient RPC transport wrapper. */
export interface RpcResilienceOptions {
  /** Per-call timeout in ms. `0` disables the timeout. */
  timeoutMs?: number
  /** Number of retries beyond the initial attempt for transient failures. */
  retryCount?: number
  /** Base backoff in ms between retries; doubles each attempt with jitter. */
  retryBackoffMs?: number
  /** Consecutive failures before the circuit breaker trips and fails fast. */
  circuitBreakerThreshold?: number
  /** Cooldown in ms the circuit breaker stays open before allowing calls through again. */
  circuitBreakerCooldownMs?: number
}

type ResolvedRpcResilienceOptions = Required<RpcResilienceOptions>

const DEFAULT_RESILIENCE: ResolvedRpcResilienceOptions = {
  timeoutMs: RPC_TIMEOUT_MS,
  retryCount: RPC_RETRY_COUNT,
  retryBackoffMs: RPC_RETRY_BACKOFF_MS,
  circuitBreakerThreshold: RPC_CIRCUIT_BREAKER_THRESHOLD,
  circuitBreakerCooldownMs: RPC_CIRCUIT_BREAKER_COOLDOWN_MS,
}

/** Thrown when an RPC call exceeds its configured `timeoutMs`. */
export class RpcTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`RPC call timed out after ${timeoutMs}ms`)
    this.name = 'RpcTimeoutError'
  }
}

/** Thrown when the circuit breaker is open and calls are failing fast. */
export class RpcCircuitOpenError extends Error {
  constructor(retryAfterMs: number) {
    super(`RPC circuit breaker is open; retry after ${retryAfterMs}ms`)
    this.name = 'RpcCircuitOpenError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RpcTimeoutError(timeoutMs)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Wraps an {@link ISorobanRpcClient} with a resilient transport:
 * - a per-call timeout (`timeoutMs`)
 * - retry with exponential backoff + jitter for transient failures (`retryCount`, `retryBackoffMs`)
 * - a circuit breaker that fails fast for `circuitBreakerCooldownMs` after
 *   `circuitBreakerThreshold` consecutive failures
 *
 * Every method on {@link ISorobanRpcClient} is wrapped identically, including
 * `getTransaction` — callers such as `waitForTransaction` keep their own
 * polling/backoff loop untouched; this only governs each individual RPC call.
 */
export class ResilientRpcClient implements ISorobanRpcClient {
  private readonly _inner: ISorobanRpcClient
  private readonly _opts: ResolvedRpcResilienceOptions
  private _consecutiveFailures = 0
  private _circuitOpenUntil = 0

  constructor(inner: ISorobanRpcClient, opts: RpcResilienceOptions = {}) {
    this._inner = inner
    this._opts = { ...DEFAULT_RESILIENCE, ...opts }
  }

  /**
   * Forwards `serverURL` from the wrapped client when present (e.g. a
   * {@link SorobanRpcClient}), so callers relying on it for SSE URL
   * construction (`Restorer.ts`) keep working through the resilient wrapper.
   */
  get serverURL(): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this._inner as any).serverURL
  }

  simulateTransaction(transaction: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
    return this._call(() => this._inner.simulateTransaction(transaction))
  }

  sendTransaction(
    transaction: Transaction | import('@stellar/stellar-sdk').FeeBumpTransaction,
  ): Promise<rpc.Api.SendTransactionResponse> {
    return this._call(() => this._inner.sendTransaction(transaction))
  }

  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    return this._call(() => this._inner.getTransaction(hash))
  }

  getAccount(publicKey: string): Promise<Account> {
    return this._call(() => this._inner.getAccount(publicKey))
  }

  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<rpc.Api.GetLedgerEntriesResponse> {
    return this._call(() => this._inner.getLedgerEntries(...keys))
  }

  getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse> {
    return this._call(() => this._inner.getLatestLedger())
  }

  private async _call<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now()
    if (this._circuitOpenUntil > now) {
      throw new RpcCircuitOpenError(this._circuitOpenUntil - now)
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= this._opts.retryCount; attempt++) {
      try {
        const result = await withTimeout(fn(), this._opts.timeoutMs)
        this._consecutiveFailures = 0
        this._circuitOpenUntil = 0
        return result
      } catch (err) {
        lastError = err
        this._consecutiveFailures++
        if (this._consecutiveFailures >= this._opts.circuitBreakerThreshold) {
          this._circuitOpenUntil = Date.now() + this._opts.circuitBreakerCooldownMs
          break
        }
        if (attempt < this._opts.retryCount) {
          const backoff = this._opts.retryBackoffMs * 2 ** attempt
          const jitter = Math.random() * backoff * 0.5
          await sleep(backoff + jitter)
        }
      }
    }

    throw lastError
  }
}

/**
 * Wraps a client with the resilient transport described in {@link ResilientRpcClient}.
 *
 * @param client - The client to wrap (a {@link SorobanRpcClient} or any test double).
 * @param opts   - Timeout/retry/circuit-breaker configuration; unset fields use SDK defaults.
 */
export function wrapWithResilience(
  client: ISorobanRpcClient,
  opts?: RpcResilienceOptions,
): ISorobanRpcClient {
  return new ResilientRpcClient(client, opts)
}
