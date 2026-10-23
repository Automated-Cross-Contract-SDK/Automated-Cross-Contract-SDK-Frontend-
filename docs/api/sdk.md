# SDK API Reference

The `@handsoff/sdk` package exposes the wallet adapter layer used by every integration.
This page documents the `WalletAdapter` contract, the `createAdapter` factory, the
`KnownWallet` / `SUPPORTED_WALLETS` registry, the capability flags, the hardware
wallet setup for Ledger and Trezor, the N-of-M multisig restore flow, the
transaction-free contract and account scanning APIs, the `estimateRestoreCost`
helper for pricing a restore before the user signs, and the optional cache
memory-bound policies.

## Stability and versioning

The SDK follows [Semantic Versioning](https://semver.org/):

- **Patch** (`x.y.Z`) — bug fixes only; no API changes.
- **Minor** (`x.Y.z`) — backwards-compatible additions (new methods, optional
  parameters, new exports). Existing code keeps working.
- **Major** (`X.y.z`) — may include breaking changes. Read the
  [Migration Guide](#migration-guide) before upgrading.

Anything not documented on this page (internal modules, `_`-prefixed helpers,
undocumented fields on returned objects) is **not** part of the public API and
may change in any release.

## Migration policy

When a major version is released:

1. **Deprecation first.** A public API is deprecated for at least one minor
   release before it is removed in a major release. Deprecated APIs emit a
   runtime warning and are annotated `@deprecated` in the type definitions.
2. **Documented replacements.** Every deprecation names its replacement in the
   warning message and in the migration notes for the release.
3. **Support window.** The previous major version receives critical bug and
   security fixes for **6 months** after the next major is published.
4. **No silent breakage.** Breaking changes are listed in the release notes and
   in the migration guide for that major version.

## Migration guide

### Upgrading to the next major version

1. **Read the release notes** for the target major version and note every item
   marked *breaking*.
2. **Update the dependency** in your manifest:

   ```bash
   npm install @your-scope/sdk@latest
   ```

3. **Resolve deprecation warnings.** Run your test suite and fix any warnings
   emitted by deprecated APIs using the documented replacements.
4. **Update type errors.** Breaking type changes surface as compile errors;
   follow the inline `@deprecated` notes and the migration notes below.
5. **Verify behavior.** Run your integration tests against the new version,
   paying attention to the boundary cases called out in the release notes.

### API changes between major versions

| Area | Change | Replacement |
| --- | --- | --- |
| Client construction | Options object is now required | Pass a config object to the client factory |
| Error handling | Errors are typed subclasses | Match on the error `code` field |
| Async APIs | Callback parameters removed | Use the returned `Promise` |

> The table above is updated with each major release. If your version is not
> listed, consult the release notes for that version.

### Deprecations and replacements

Deprecated APIs remain available for at least one minor release. Each entry
below lists the deprecated API and the replacement to migrate to:

## Cache memory-bound policies

The SDK keeps a few optional in-memory caches (for example resolved account
metadata and simulation results). By default these caches are unbounded, which is
fine for short-lived scripts but can grow without limit during long-running
sessions. Pass a `cachePolicy` to `createAdapter` to bound them.

```ts
export interface CachePolicy {
  /** Maximum number of entries retained per cache. `0` disables the cache. */
  maxEntries?: number
  /** Maximum total approximate byte size retained per cache. */
  maxBytes?: number
  /** Time-to-live in milliseconds; entries older than this are evicted. */
  ttlMs?: number
  /** Eviction strategy when a bound is exceeded. Defaults to `'lru'`. */
  eviction?: 'lru' | 'fifo'
}
```

All fields are optional. When omitted, the cache keeps its previous unbounded
behaviour, so existing integrations are unaffected. Bounds are enforced on every
write: the least-recently-used (or oldest, for `fifo`) entries are evicted until
both `maxEntries` and `maxBytes` are satisfied, and entries older than `ttlMs`
are dropped on read.

```ts
import { createAdapter, KnownWallet } from '@handsoff/sdk'

const adapter = createAdapter({
  wallet: KnownWallet.Phantom,
  cachePolicy: {
    maxEntries: 500,
    maxBytes: 2 * 1024 * 1024,
    ttlMs: 5 * 60 * 1000,
    eviction: 'lru',
  },
})
```

Set `maxEntries: 0` to disable a cache entirely. Invalid policies (negative
bounds, non-finite numbers) throw `InvalidCachePolicyError` at construction time
rather than silently degrading.

### Migration notes

- `cachePolicy` is additive and optional; no changes are required for existing
  callers.
- The default remains unbounded to preserve prior behaviour. Long-running
  services should set at least `maxEntries` or `ttlMs`.

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

## Transaction history: storage and privacy

The SDK records a local transaction history so applications can show recent
activity and restore context. This section documents what that history may
contain, how long it is retained, the encryption requirements for persisted
history, and how to disable persistence entirely.

### What history may contain

Each history entry is a record of a single submission attempt. Entries may
include:

| Field             | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| `id`              | Stable entry identifier generated by the SDK.                                |
| `signature`       | Transaction signature, once the network confirms the submission.            |
| `status`          | Lifecycle status (`pending`, `confirmed`, `failed`, `cancelled`).           |
| `operations`      | Ordered operation type names included in the transaction.                   |
| `walletId`        | `KnownWallet` id of the adapter that signed the transaction.                |
| `account`         | Public key of the signing account.                                          |
| `timeBounds`      | Absolute `minTime` / `maxTime` bounds applied to the transaction, if any.   |
| `estimatedFee`    | Estimated fee in stroops, when computed.                                    |
| `createdAt`       | Unix-second timestamp when the entry was recorded.                          |
| `error`           | Failure code and message when the submission did not succeed.               |

History never stores private keys, seed phrases, signed transaction envelopes,
or arbitrary message payloads. Only the fields above are persisted; anything
else the application needs must be stored by the application itself.

### Retention

History is retained locally until it is cleared. The SDK does not expire entries
on its own, so applications choose the retention window that matches their
privacy policy. Two controls are available:

- `history.clear()` removes every entry for the current adapter.
- `history.clear({ before })` removes entries created before a Unix-second
  timestamp, which is useful for enforcing a rolling retention window.

```ts
// Keep only the last 30 days of history.
const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
await history.clear({ before: cutoff })
```

Applications should clear history on sign-out and document their chosen
retention window in their own privacy policy.

### Encryption requirements

When history is persisted to durable storage (for example `localStorage`,
`IndexedDB`, or a native key-value store), it **must** be encrypted at rest:

- Use authenticated encryption (AEAD) such as AES-GCM with a key of at least
  256 bits.
- Derive or store the encryption key outside the persisted history payload; do
  not write the key alongside the ciphertext.
- Rotate the key and re-encrypt history when the account changes.
- Treat the storage backend as untrusted: assume an attacker can read and modify
  it, and rely on authentication tags to detect tampering.

In-memory history (the default) does not require encryption because it never
leaves the process.

### Disabling persistence

Persistence is opt-in. By default history lives only in memory and is discarded
when the adapter disconnects. To guarantee nothing is written to durable
storage, disable persistence explicitly:

```ts
const adapter = createAdapter({
  wallet: KnownWallet.Phantom,
  config: { history: { persist: false } },
})
```

With `persist: false` the SDK never reads or writes durable storage for history;
`history.clear()` remains available and is a no-op when nothing is stored.
Applications that handle sensitive accounts should disable persistence and keep
history in memory only.

## Hardware wallets

## Compatibility notes

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
