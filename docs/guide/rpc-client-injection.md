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

## Example: a test double

Implement `ISorobanRpcClient` directly for unit tests. TypeScript enforces
that all six methods are present, so a mock can't silently omit one the code
under test ends up calling:

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
