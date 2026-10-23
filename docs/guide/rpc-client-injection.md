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

## Concurrency limits for ledger lookups

When the SDK needs to look up many ledger entries at once (for example when
checking TTLs across a large set of keys), it issues `getLedgerEntries`
calls in parallel. To avoid overwhelming the RPC endpoint, the number of
in-flight requests is bounded by `config.maxConcurrentLedgerLookups`.

```typescript
const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  // At most 5 ledger lookups in flight at any time. Defaults to 10.
  maxConcurrentLedgerLookups: 5,
})
```

- **Setting:** `maxConcurrentLedgerLookups` (optional, positive integer).
- **Default:** `10` when omitted.
- **Behavior:** large inputs are split into batches that respect the limit;
  results are returned in the same order as the input keys, so no entries
  are lost or reordered regardless of the limit.
- **Validation:** a non-positive or non-integer value throws a
  `ConfigurationError` at construction time.

This setting is purely a client-side bound and does not change the RPC
protocol or the shape of any response, so it is backward compatible: existing
configurations that omit it keep the previous default behavior.

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

## Example: a wallet-free test using the mock RPC harness

For end-to-end style tests that exercise success, failure, and restore
scenarios without a live network or a wallet extension, use the mock RPC
harness instead of hand-rolling a client. The harness implements
`ISorobanRpcClient`, so it plugs into `config.rpcClient` exactly like a real
client and requires no signing or browser wallet.

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { createMockRpcHarness } from '@soroban-resurrect/sdk/testing'
import { describe, it, expect } from 'vitest'

function makeSdk(harness: ReturnType<typeof createMockRpcHarness>) {
  return new SorobanResurrect({
    rpcUrl: 'https://mock.local',
    rpcClient: harness.client,
  })
}

describe('restore flows (wallet-free)', () => {
  it('succeeds when the entry is restorable', async () => {
    const harness = createMockRpcHarness()
    harness.setLedgerEntry({ /* live entry */ })
    harness.setSimulation({ success: true })

    const result = await makeSdk(harness).restore({ /* keys */ })

    expect(result.status).toBe('restored')
    expect(harness.calls.simulateTransaction).toHaveLength(1)
  })

  it('reports failure when simulation fails', async () => {
    const harness = createMockRpcHarness()
    harness.setSimulation({ success: false, error: 'host invocation failed' })

    const result = await makeSdk(harness).restore({ /* keys */ })

    expect(result.status).toBe('failed')
    expect(harness.calls.sendTransaction).toHaveLength(0)
  })

  it('restores after an expired entry is detected', async () => {
    const harness = createMockRpcHarness()
    harness.setLedgerEntry({ /* archived entry */, liveUntilLedger: 0 })
    harness.setLatestLedger(100)
    harness.setSimulation({ success: true })

    const result = await makeSdk(harness).restore({ /* keys */ })

    expect(result.status).toBe('restored')
    expect(harness.calls.sendTransaction).toHaveLength(1)
  })
})
```

The harness exposes a stable surface for tests:

- `harness.client` — an `ISorobanRpcClient` to pass as `config.rpcClient`.
- `harness.setLedgerEntry(entry)` / `harness.setLatestLedger(n)` — seed
  ledger state, including archived entries for restore scenarios.
- `harness.setSimulation({ success, error? })` — control whether
  `simulateTransaction` succeeds or fails.
- `harness.calls` — recorded invocations per method, for assertions.

Because the harness is a plain `ISorobanRpcClient`, no wallet extension or
signing key is involved: transactions are simulated and sent against the
in-memory harness, so tests run deterministically in CI.

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
- The mock RPC harness (`@soroban-resurrect/sdk/testing`) is a test-only
  entry point. It is additive and does not affect production bundles; code
  that never imports it is unaffected.
