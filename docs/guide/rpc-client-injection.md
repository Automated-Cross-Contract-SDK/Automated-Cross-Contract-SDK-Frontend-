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

## Instrumentation hooks

For request duration and payload-size metrics, pass an optional
`instrumentation` object in the SDK config. Hooks are invoked after each RPC
call and receive only metadata — **payload contents are never captured by
default**, only their byte size.

```typescript
import { SorobanResurrect, type RpcInstrumentation } from '@soroban-resurrect/sdk'

const instrumentation: RpcInstrumentation = {
  onRequest(event) {
    // event.method: e.g. 'simulateTransaction'
    // event.durationMs: wall-clock duration of the call
    // event.requestBytes / event.responseBytes: serialized payload sizes
    // event.ok: whether the call resolved without throwing
    metrics.histogram('rpc.duration', event.durationMs, { method: event.method })
    metrics.histogram('rpc.request_bytes', event.requestBytes, { method: event.method })
    metrics.histogram('rpc.response_bytes', event.responseBytes, { method: event.method })
  },
}

const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  instrumentation,
})
```

The `RpcInstrumentationEvent` shape is stable:

```typescript
type RpcInstrumentationEvent = {
  method: keyof ISorobanRpcClient
  durationMs: number
  requestBytes: number
  responseBytes: number
  ok: boolean
}
```

Hooks are best-effort: a throwing hook never fails the underlying RPC call.
Omit `instrumentation` to disable all overhead. Payload contents are not
included in the event; if you need them, wrap the client yourself as shown
above.

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
