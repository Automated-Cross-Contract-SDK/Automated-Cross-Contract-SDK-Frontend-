# SDK API

The `@handsoff/sdk` package exposes the wallet adapter layer used by every integration.
This page documents the `WalletAdapter` contract, the `createAdapter` factory, the
`KnownWallet` / `SUPPORTED_WALLETS` registry, the capability flags, the hardware
wallet setup for Ledger and Trezor, the N-of-M multisig restore flow, the
transaction-free contract and account scanning APIs, and the `estimateRestoreCost`
helper for pricing a restore before the user signs.

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

##### Dry-run mode

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
30-second rebuild timeout.

**Compatibility:** callers that previously handled an expired bound as a
generic error can branch on the new `ORIGINAL_TRANSACTION_EXPIRED` error code
and inspect `result.expiredTransaction`. The SDK never automatically extends
an expired maximum time.

### Typed workflow failures

Failed `submitWithRestore` results retain their readable `error` and existing
`errorCode`, and now include `failure` metadata with a lifecycle `stage`,
stable `code`, `retryable` flag, and safe `nextStep` guidance:

```ts
if (!result.success && result.failure) {
  console.error(result.error) // readable diagnostic
  showRecoveryAction(result.failure.nextStep)
  if (result.failure.retryable) {
    offerRetryFor(result.failure.code)
  }
}
```

Decoded on-chain diagnostics remain available separately as
`result.onchainError`; do not display raw diagnostic data as recovery guidance.

#### `onStateChange(listener)`

```typescript
onStateChange(listener: (info: RestoreStateInfo) => void): () => void
```

#### Framework-independent subscription store

`createSubscriptionStore<T>(initialSnapshot)` provides a small typed external
store that does not depend on React, Vue, Svelte, or another UI framework. It is
intended for framework bindings and adapters that need a stable snapshot,
synchronous change notifications, and an unsubscribe handle.

```typescript
import { createSubscriptionStore } from '@soroban-resurrect/sdk'

const store = createSubscriptionStore({ state: 'idle' })
const unsubscribe = store.subscribe((snapshot) => {
  console.log(snapshot.state)
})

store.setSnapshot({ state: 'success' })
console.log(store.getSnapshot())
unsubscribe()
```

Subscribers are called only when the snapshot changes according to `Object.is`.
The returned `unsubscribe` function is safe to call more than once.

#### Cancelling workflows and disposing an instance

Pass an `AbortSignal` to `submitWithRestore` to cancel the local workflow:

```typescript
const controller = new AbortController()
const pending = resurrect.submitWithRestore({ transaction, wallet, signal: controller.signal })

controller.abort()
const result = await pending // { success: false, error: 'Operation cancelled', ... }
```

Cancellation prevents subsequent workflow stages and interrupts transaction
polling. It cannot reverse an already-submitted on-chain transaction or
dismiss a wallet prompt if the adapter does not support that. Call
`resurrect.dispose()` when an owned SDK instance is no longer needed; it stops
tracked TTL watches and removes state and event listeners. Disposal is
idempotent.

### Latency and UX

Hardware signing is interactive: the user must confirm on the device. Expect
several seconds per signature versus sub-second for browser wallets, and design
flows so each signature is a deliberate step. When `blindSigning` is set the SDK
warns the user that the device cannot display the full payload before they confirm.

## Custom adapters

Implement `WalletAdapter` and pass the class to `createAdapter`:

```ts
import { createAdapter, type WalletAdapter } from '@handsoff/sdk'

class MyWalletAdapter implements WalletAdapter {
  readonly id = 'my-wallet'
  readonly name = 'My Wallet'
  readonly capabilities = {
    signTransaction: true,
    signMessage: false,
    hardware: false,
    blindSigning: false,
    multiAccount: false,
  }

  async connect() {
    /* ... */
  }
  async disconnect() {
    /* ... */
  }
  async signTransaction(tx) {
    /* ... */
  }
  async signMessage() {
    throw new Error('signMessage is not supported')
  }
}

const adapter = createAdapter({ adapter: MyWalletAdapter })
```

## `estimateRestoreCost`

`estimateRestoreCost(transaction)` prices the restore work a transaction would
trigger before the user signs. It inspects the transaction's ledger keys, detects
which of them are archived, and returns the extra fee the restore would add on top
of the base fee. It is the natural companion to a "this will cost extra because it
needs a restore" confirmation step.

```ts
export function estimateRestoreCost(transaction: Transaction): Promise<RestoreCostEstimate>
```

### `RestoreCostEstimate`

| Field                  | Type          | Meaning                                                                          |
| ---------------------- | ------------- | -------------------------------------------------------------------------------- |
| `minResourceFee`       | `number`      | Minimum resource fee (in stroops) the network charges for the restore operation. |
| `multiplier`           | `number`      | Fee multiplier applied to `minResourceFee` to derive `estimatedFee`.             |
| `estimatedFee`         | `number`      | Total estimated restore fee (in stroops): `minResourceFee * multiplier`.         |
| `archivedKeysDetected` | `PublicKey[]` | Ledger keys referenced by the transaction that are currently archived.           |
| `wouldNeedRestore`     | `boolean`     | Whether the transaction would trigger a restore at all.                          |

### Zero-fee behaviour

When none of the transaction's ledger keys are archived, `wouldNeedRestore` is
`false`, `archivedKeysDetected` is empty, and `estimatedFee` is `0`. In that case
the transaction can be submitted as-is and no restore step is required — skip the
confirmation prompt entirely.

### Worked example: confirm the cost before signing

```ts
import { estimateRestoreCost } from '@handsoff/sdk'

const estimate = await estimateRestoreCost(transaction)

if (estimate.wouldNeedRestore) {
  // Surface the extra cost to the user before they sign.
  const feeInSol = estimate.estimatedFee / 1e9
  const confirmed = await confirm({
    title: 'This transaction needs a restore',
    message:
      `${estimate.archivedKeysDetected.length} archived key(s) will be restored. ` +
      `Estimated extra fee: ${feeInSol} SOL.`,
  })

  if (!confirmed) {
    return // User declined — do not sign or submit.
  }
} else {
  // wouldNeedRestore === false: no restore, no extra fee.
  console.log('No restore needed; estimatedFee is 0.')
}

const signed = await adapter.signTransaction(transaction)
await submit(signed)
```

See the [fee model guide](../guide/fee-model.md) for how the restore fee fits into
the overall fee calculation, and the [TTL guides](../guide/ttl.md) for how entries
become archived in the first place.

`createDebugger` is exported, so application code can log under the same
namespaces and honour the same `DEBUG` filter:

The scanning APIs answer "what in my contract or account is about to expire?"
without submitting a transaction. They read ledger entries directly and report
which ones are close to their TTL, so a dApp can prompt the user to extend or
restore state before it is archived.

const debug = createDebugger('soroban-resurrect:my-app')
debug('restore started for %d keys', keys.length)

```

```
