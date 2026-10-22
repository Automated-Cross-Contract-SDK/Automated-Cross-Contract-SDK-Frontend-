# SDK API

The `@handsoff/sdk` package exposes the wallet adapter layer used by every integration.
This page documents the `WalletAdapter` contract, the `createAdapter` factory, the
`KnownWallet` / `SUPPORTED_WALLETS` registry, the capability flags, the hardware
wallet setup for Ledger and Trezor, the N-of-M multisig restore flow, the
transaction-free contract and account scanning APIs, the `estimateRestoreCost`
helper for pricing a restore before the user signs, and the `wrapRpcClient`
helper for injecting a custom RPC transport.

## `WalletAdapter`

Every wallet integration implements the same contract:

```ts
export interface WalletAdapter {
  /** Stable identifier, usually a `KnownWallet` value. */
  readonly id: string
  /** Human readable name shown in wallet pickers. */
  readonly name: string
  /** Capabilities this adapter supports. */
  readonly capabilities: WalletCapabilities
  /** Connect and resolve the active account. */
  connect(): Promise<WalletAccount>
  /** Disconnect and release any transport resources. */
  disconnect(): Promise<void>
  /** Sign a transaction payload. */
  signTransaction(tx: Transaction): Promise<SignedTransaction>
  /** Sign an arbitrary message. */
  signMessage(message: Uint8Array): Promise<Uint8Array>
}
```

## `createAdapter`

`createAdapter` is the factory used to instantiate an adapter from a `KnownWallet`
value or a custom adapter class. It normalises configuration, applies defaults, and
returns a ready-to-use `WalletAdapter`.

```ts
import { createAdapter, KnownWallet } from '@handsoff/sdk'

const adapter = createAdapter(KnownWallet.Phantom)
await adapter.connect()
```

It accepts either a known wallet or a custom adapter:

```ts
const adapter = createAdapter({
  wallet: KnownWallet.Ledger,
  config: { transport, manifest },
})
```

## `KnownWallet` and `SUPPORTED_WALLETS`

`KnownWallet` enumerates every wallet the SDK ships an adapter for. `SUPPORTED_WALLETS`
is the runtime list (id, name, capabilities) used to build wallet pickers.

| `KnownWallet` value    | Adapter                 | Notes                                   |
| ---------------------- | ----------------------- | --------------------------------------- |
| `KnownWallet.Phantom`  | `PhantomWalletAdapter`  | Browser extension                       |
| `KnownWallet.Solflare` | `SolflareWalletAdapter` | Browser extension                       |
| `KnownWallet.Backpack` | `BackpackWalletAdapter` | Browser extension                       |
| `KnownWallet.Glow`     | `GlowWalletAdapter`     | Browser extension                       |
| `KnownWallet.Ledger`   | `LedgerWalletAdapter`   | Hardware, requires transport + manifest |
| `KnownWallet.Trezor`   | `TrezorWalletAdapter`   | Hardware, requires transport + manifest |

```ts
import { SUPPORTED_WALLETS } from '@handsoff/sdk'

for (const wallet of SUPPORTED_WALLETS) {
  console.log(wallet.id, wallet.name, wallet.capabilities)
}
```

## Capability flags

Each adapter advertises what it can do. The SDK branches on these flags, so an
unsupported operation fails fast instead of silently degrading.

| Flag              | Meaning                              | SDK behaviour that depends on it                                                       |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `signTransaction` | Can sign transactions                | `signTransaction()` is exposed; otherwise the call throws `UnsupportedCapabilityError` |
| `signMessage`     | Can sign arbitrary messages          | `signMessage()` is exposed; used by auth / SIWS flows                                  |
| `hardware`        | Backed by a hardware device          | Enables transport lifecycle management and blind-signing warnings                      |
| `blindSigning`    | Device can sign without full display | SDK emits a blind-signing warning before signing                                       |
| `multiAccount`    | Can expose multiple accounts         | Account picker is shown after `connect()`                                              |

## Custom RPC client injection

`wrapRpcClient` wraps any `RpcClient` (or `Connection`) with a custom transport so
you can add logging, proxying, or deterministic test doubles without changing the
SDK workflow. The wrapper implements the same `RpcClient` interface, so it can be
passed anywhere the SDK accepts an RPC client.

```ts
export interface RpcClient {
  /** Send a JSON-RPC request and resolve the raw result. */
  request<T = unknown>(method: string, params?: unknown[]): Promise<T>
}

export interface WrapRpcClientOptions {
  /** Underlying client that performs the actual request. */
  client: RpcClient
  /** Called before each request is forwarded. */
  onRequest?: (method: string, params: unknown[]) => void
  /** Called after each request resolves or rejects. */
  onResponse?: (method: string, result: unknown, error?: unknown) => void
}

export function wrapRpcClient(options: WrapRpcClientOptions): RpcClient
```

### Logging

```ts
import { wrapRpcClient } from '@handsoff/sdk'

const rpc = wrapRpcClient({
  client: connection,
  onRequest: (method, params) => console.debug('[rpc]', method, params),
  onResponse: (method, result, error) =>
    error ? console.error('[rpc]', method, error) : console.debug('[rpc]', method, result),
})

const sr = createSdk({ rpc })
```

### Proxying

```ts
const rpc = wrapRpcClient({
  client: connection,
  onRequest: (method, params) => proxy.forward(method, params),
})
```

### Testing

```ts
import { wrapRpcClient } from '@handsoff/sdk'

const calls: string[] = []
const rpc = wrapRpcClient({
  client: {
    request: async (method) => {
      calls.push(method)
      return { context: { slot: 0 }, value: [] }
    },
  },
})

await rpc.request('getProgramAccounts', [programId])
expect(calls).toEqual(['getProgramAccounts'])
```

`wrapRpcClient` forwards the method and params unchanged and re-throws any error
from the underlying client after invoking `onResponse`, so existing error handling
keeps working. It is a pure wrapper: it does not retry, cache, or mutate requests.

## Hardware wallets

Hardware adapters need a transport to talk to the device and a manifest so the
device can display the requesting app. Both are passed through `createAdapter`.

### Ledger

```bash
npm install @ledgerhq/hw-transport-webhid @ledgerhq/hw-app-solana
```

```ts
import TransportWebHID from '@ledgerhq/hw-transport-webhid'
import { createAdapter, KnownWallet } from '@handsoff/sdk'

const transport = await TransportWebHID.create()

const adapter = createAdapter({
  wallet: KnownWallet.Ledger,
  config: {
    transport,
    manifest: {
      name: 'My App',
      url: 'https://example.com',
      icon: 'https://example.com/icon.png',
    },
  } satisfies LedgerAdapterConfig,
})
```

### Trezor

```bash
npm install @trezor/connect-web
```

Submits a transaction with automatic archive restoration. If the simulation detects archived entries, a restore transaction is built, signed, submitted, and confirmed before the original transaction is rebuilt and submitted. State transitions are published to all registered listeners throughout. See [`SubmitWithRestoreOptions`](/api/types#submitwithrestoreoptions) for the full set of lifecycle callbacks.

Call `sr.cancel()` to abort every active `submitWithRestore` workflow, or pass
an `AbortSignal` as `signal` in `SubmitWithRestoreOptions` to cancel one call.
Cancellation prevents subsequent workflow steps and stops confirmation polling;
it cannot dismiss an in-flight wallet prompt or retract a transaction already
submitted to the network. The method returns `true` only when it newly cancels
at least one active workflow.

Call `previewRestore` for a walletless preview, or pass `dryRun: true` to
`submitWithRestore` when using the same options shape as a normal submission:

```typescript
const preview = await sr.previewRestore(transaction)
console.log(preview.intendedOperations)
console.log(preview.archivedKeys)
console.log(preview.estimatedRestoreFee)

const result = await sr.submitWithRestore({ transaction, wallet, dryRun: true })
```

Both paths simulate only and return the ordered operation type names, detected
archived ledger entries, and estimated restore fee when needed. Neither path
signs or submits; `previewRestore` does not require a wallet. The `dryRun`
option also does not record history or invoke lifecycle callbacks. Simulation
failures are returned in `simulationError` (and typed `failure` guidance), not
silently treated as a successful preview.

### Rebuilding with transaction time bounds

After a successful restore, the SDK rebuilds the original operations using a fresh
sequence number. The rebuilt transaction preserves the original absolute
`minTime` and `maxTime` bounds; it does not turn a nearly expired bound into a new
relative timeout. If the original `maxTime` has elapsed before rebuilding, the
SDK refuses to extend the user's intent.

When the application has explicit authorization to replace the original expiry,
provide `approveExpiredRebuild`. It receives the original bounds and must return
new future Unix-second bounds to approve the rebuild. Omitting the callback or
returning `undefined` stops after the restore transaction and returns
`ORIGINAL_TRANSACTION_EXPIRED` with an `expiredTransaction` payload:

```ts
const result = await sr.submitWithRestore({
  transaction,
  wallet,
  approveExpiredRebuild: async ({ originalTimeBounds }) => {
    const approved = await confirmReplaceExpiry(originalTimeBounds)
    if (!approved) return undefined
    const now = Math.floor(Date.now() / 1000)
    return { minTime: now, maxTime: now + 60 }
  },
})
```

The SDK validates approved bounds and returns `INVALID_REBUILD_TIME_BOUNDS` if
they are not valid. `rebuildTimeBounds` remains available to set bounds before
they expire; it does not bypass the explicit approval callback for an already
expired original. Existing transactions without time bounds retain the prior
30-second reb

/* … truncated 6863 chars — edit only what you need near the top … */
