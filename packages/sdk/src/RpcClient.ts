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
  simulateTransaction(transaction: Transaction): Promise<rpc.Api.SimulateTransactionResponse>

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
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<rpc.Api.GetLedgerEntriesResponse>

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
   * Lazily-created underlying `rpc.Server` instance.
   *
   * Deferring construction until the first RPC call avoids paying the startup
   * cost for an SDK instance that is created in a React render path but never
   * used during that render.
   */
  private _serverInstance?: rpc.Server

  /**
   * Backwards-compatible access to the underlying server instance. Accessing
   * this property triggers the lazy initialization, which keeps the public
   * surface stable while deferring the expensive constructor call.
   */
  public get _server(): rpc.Server {
    return this.ensureServer()
  }

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
    this.serverURL = rpcUrl
  }

  private ensureServer(): rpc.Server {
    if (!this._serverInstance) {
      this._serverInstance = new rpc.Server(this.serverURL)
    }
    return this._serverInstance
  }

  simulateTransaction(transaction: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
    return this.ensureServer().simulateTransaction(transaction)
  }

  sendTransaction(
    transaction: Transaction | import('@stellar/stellar-sdk').FeeBumpTransaction,
  ): Promise<rpc.Api.SendTransactionResponse> {
    return this.ensureServer().sendTransaction(transaction)
  }

  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    return this.ensureServer().getTransaction(hash)
  }

  getAccount(publicKey: string): Promise<Account> {
    return this.ensureServer().getAccount(publicKey)
  }

  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<rpc.Api.GetLedgerEntriesResponse> {
    return this.ensureServer().getLedgerEntries(...keys)
  }

  getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse> {
    return this.ensureServer().getLatestLedger()
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
