# RPC Client Injection

By default, `SorobanResurrect` creates a `SorobanRpcClient` internally from
`config.rpcUrl`. If you need to observe, cache, rate-limit, or fake RPC
calls, inject your own client via `config.rpcClient` instead. Every SDK
function that talks to the network is typed against the `ISorobanRpcClient`
interface rather than the concrete `rpc.Server` class, so any object that
implements it works as a drop-in replacement.

See [RPC Client Injection](../API.md#rpc-client-injection) in the API
reference for the full interface and export list.

## Example: a caching + logging wrapper

This example wraps the default client so that `getLatestLedger` results are
cached for a few seconds (it's polled frequently during TTL checks and
restore confirmation) and every call is logged.

```typescript
import {
  createRpcClient,
  SorobanResurrect,
  type ISorobanRpcClient,
} from '@soroban-resurrect/sdk'
import type { rpc } from '@stellar/stellar-sdk'

function withCachingAndLogging(client: ISorobanRpcClient): ISorobanRpcClient {
  let cachedLedger: { value: rpc.Api.GetLatestLedgerResponse; expiresAt: number } | null = null
  const CACHE_TTL_MS = 3_000

  return {
    ...client,

    async getLatestLedger() {
      const now = Date.now()
      if (cachedLedger && cachedLedger.expiresAt > now) {
        console.log('[rpc] getLatestLedger (cache hit)')
        return cachedLedger.value
      }

      console.log('[rpc] getLatestLedger (cache miss)')
      const value = await client.getLatestLedger()
      cachedLedger = { value, expiresAt: now + CACHE_TTL_MS }
      return value
    },

    async simulateTransaction(transaction) {
      console.log('[rpc] simulateTransaction')
      return client.simulateTransaction(transaction)
    },

    async sendTransaction(transaction) {
      console.log('[rpc] sendTransaction')
      return client.sendTransaction(transaction)
    },
  }
}

const baseClient = createRpcClient('https://soroban-testnet.stellar.org')

const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  rpcClient: withCachingAndLogging(baseClient),
})
```

Only override the methods you care about — spreading `...client` first means
every method not explicitly overridden still delegates to the wrapped
client, so `ISorobanRpcClient`'s six-method contract stays satisfied.

## Example: a proxying wrapper

To route calls through an intermediary (a gateway, a metrics sidecar, or a
regional proxy) without touching SDK call sites, wrap the client and forward
every method. Because the wrapper is a plain object, you can add
cross-cutting concerns like retries or request IDs in one place:

```typescript
import {
  createRpcClient,
  SorobanResurrect,
  type ISorobanRpcClient,
} from '@soroban-resurrect/sdk'

function withProxy(
  client: ISorobanRpcClient,
  proxyUrl: string,
): ISorobanRpcClient {
  // Forward each call through the proxy endpoint. The wrapped client still
  // owns serialization and response parsing; the proxy only sees the
  // request/response envelope.
  return {
    ...client,

    async getAccount(accountId) {
      console.log(`[proxy] getAccount ${accountId} via ${proxyUrl}`)
      return client.getAccount(accountId)
    },

    async getLedgerEntries(keys) {
      console.log(`[proxy] getLedgerEntries (${keys.length} keys)`)
      return client.getLedgerEntries(keys)
    },
  }
}

const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  rpcClient: withProxy(
    createRpcClient('https://soroban-testnet.stellar.org'),
    'https://rpc-proxy.internal.example',
  ),
})
```

## Check restore compatibility

Use `checkNetworkCapabilities()` before enabling restore flows in an
application to verify that the configured endpoint targets the expected
network, supports protocol 20 or later, and exposes the RPC methods required
by this SDK:

```typescript
const report = await sdk.checkNetworkCapabilities()

if (report.status !== 'compatible') {
  console.warn(report.messages)
  // 'incompatible' is a confirmed mismatch; 'unknown' means the endpoint
  // or custom client did not provide enough information to verify support.
}
```

The method checks `getNetwork()` and `getVersionInfo()` in addition to the
SDK's required RPC methods. These two metadata probes are optional for
custom `ISorobanRpcClient` implementations; when omitted or unavailable, the
report is `unknown`, not a false claim of compatibility. Implement and
forward both methods in custom wrappers for a complete report.

## Example: a test double

Implement `ISorobanRpcClient` directly for unit tests. TypeScript enforces
that all six required methods are present; `getNetwork()` and
`getVersionInfo()` are optional so older custom clients remain usable:

```typescript
import type { ISorobanRpcClient } from '@soroban-resurrect/sdk'
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { vi } from 'vitest'

const mockClient: ISorobanRpcClient = {
  simulateTransaction: vi.fn().mockResolvedValue({ /* ... */ }),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getAccount: vi.fn(),
  getLedgerEntries: vi.fn(),
  getLatestLedger: vi.fn(),
}

const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  rpcClient: mockClient,
})

// Drive assertions against mockClient.simulateTransaction, etc.
```

## Compatibility and migration notes

- `config.rpcClient` is optional and additive. Existing code that only sets
  `config.rpcUrl` keeps working unchanged; the SDK builds a default client
  for you.
- `ISorobanRpcClient` requires six methods (`simulateTransaction`,
  `sendTransaction`, `getTransaction`, `getAccount`, `getLedgerEntries`,
  `getLatestLedger`). `getNetwork()` and `getVersionInfo()` are optional.
- Custom clients written before `getNetwork()`/`getVersionInfo()` existed
  remain valid; `checkNetworkCapabilities()` reports `unknown` for the
  metadata probes it cannot answer rather than failing.
- When both `rpcUrl` and `rpcClient` are provided, `rpcClient` wins for all
  network calls; `rpcUrl` is still used for display and diagnostics.
