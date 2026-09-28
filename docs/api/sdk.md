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
  readonly id: string;
  /** Human readable name shown in wallet pickers. */
  readonly name: string;
  /** Capabilities this adapter supports. */
  readonly capabilities: WalletCapabilities;
  /** Connect and resolve the active account. */
  connect(): Promise<WalletAccount>;
  /** Disconnect and release any transport resources. */
  disconnect(): Promise<void>;
  /** Sign a transaction payload. */
  signTransaction(tx: Transaction): Promise<SignedTransaction>;
  /** Sign an arbitrary message. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
```

## `createAdapter`

`createAdapter` is the factory used to instantiate an adapter from a `KnownWallet`
value or a custom adapter class. It normalises configuration, applies defaults, and
returns a ready-to-use `WalletAdapter`.

```ts
import { createAdapter, KnownWallet } from '@handsoff/sdk';

const adapter = createAdapter(KnownWallet.Phantom);
await adapter.connect();
```

It accepts either a known wallet or a custom adapter:

```ts
const adapter = createAdapter({
  wallet: KnownWallet.Ledger,
  config: { transport, manifest },
});
```

## `KnownWallet` and `SUPPORTED_WALLETS`

`KnownWallet` enumerates every wallet the SDK ships an adapter for. `SUPPORTED_WALLETS`
is the runtime list (id, name, capabilities) used to build wallet pickers.

| `KnownWallet` value | Adapter | Notes |
| --- | --- | --- |
| `KnownWallet.Phantom` | `PhantomWalletAdapter` | Browser extension |
| `KnownWallet.Solflare` | `SolflareWalletAdapter` | Browser extension |
| `KnownWallet.Backpack` | `BackpackWalletAdapter` | Browser extension |
| `KnownWallet.Glow` | `GlowWalletAdapter` | Browser extension |
| `KnownWallet.Ledger` | `LedgerWalletAdapter` | Hardware, requires transport + manifest |
| `KnownWallet.Trezor` | `TrezorWalletAdapter` | Hardware, requires transport + manifest |

```ts
import { SUPPORTED_WALLETS } from '@handsoff/sdk';

for (const wallet of SUPPORTED_WALLETS) {
  console.log(wallet.id, wallet.name, wallet.capabilities);
}
```

## Capability flags

Each adapter advertises what it can do. The SDK branches on these flags, so an
unsupported operation fails fast instead of silently degrading.

| Flag | Meaning | SDK behaviour that depends on it |
| --- | --- | --- |
| `signTransaction` | Can sign transactions | `signTransaction()` is exposed; otherwise the call throws `UnsupportedCapabilityError` |
| `signMessage` | Can sign arbitrary messages | `signMessage()` is exposed; used by auth / SIWS flows |
| `hardware` | Backed by a hardware device | Enables transport lifecycle management and blind-signing warnings |
| `blindSigning` | Device can sign without full display | SDK emits a blind-signing warning before signing |
| `multiAccount` | Can expose multiple accounts | Account picker is shown after `connect()` |

## Hardware wallets

Hardware adapters need a transport to talk to the device and a manifest so the
device can display the requesting app. Both are passed through `createAdapter`.

### Ledger

```bash
npm install @ledgerhq/hw-transport-webhid @ledgerhq/hw-app-solana
```

```ts
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import { createAdapter, KnownWallet } from '@handsoff/sdk';

const transport = await TransportWebHID.create();

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
});
```

### Trezor

```bash
npm install @trezor/connect-web
```

Submits a transaction with automatic archive restoration. If the simulation detects archived entries, a restore transaction is built, signed, submitted, and confirmed before the original transaction is rebuilt and submitted. State transitions are published to all registered listeners throughout. See [`SubmitWithRestoreOptions`](/api/types#submitwithrestoreoptions) for the full set of lifecycle callbacks.

##### Dry-run mode

Pass `dryRun: true` to preview a restore without signing or submitting anything:

```typescript
const result = await sr.submitWithRestore({ transaction, wallet, dryRun: true })

if (result.dryRun) {
  console.log(result.dryRunResult?.archivedKeys)
  console.log(result.dryRunResult?.estimatedRestoreFee)
}
```

In dry-run mode the SDK runs archive detection plus fee estimation and returns
`{ success: true, dryRun: true, dryRunResult }`. It performs **zero wallet calls**
(no `signTransaction`, no `signAuthEntry`) and **zero submissions** (no
`sendTransaction`), and it does not record anything to history. Because no wallet
callbacks fire, none of the lifecycle callbacks in `SubmitWithRestoreOptions` are
invoked either. If fee estimation fails, the error is surfaced on
`dryRunResult.simulationError` rather than thrown.

#### `onStateChange(listener)`

```typescript
onStateChange(listener: (info: RestoreStateInfo) => void): () => void
```

### Latency and UX

Hardware signing is interactive: the user must confirm on the device. Expect
several seconds per signature versus sub-second for browser wallets, and design
flows so each signature is a deliberate step. When `blindSigning` is set the SDK
warns the user that the device cannot display the full payload before they confirm.

## Custom adapters

Implement `WalletAdapter` and pass the class to `createAdapter`:

```ts
import { createAdapter, type WalletAdapter } from '@handsoff/sdk';

class MyWalletAdapter implements WalletAdapter {
  readonly id = 'my-wallet';
  readonly name = 'My Wallet';
  readonly capabilities = {
    signTransaction: true,
    signMessage: false,
    hardware: false,
    blindSigning: false,
    multiAccount: false,
  };

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
    throw new Error('signMessage is not supported');
  }
}

const adapter = createAdapter({ adapter: MyWalletAdapter });
```

## `estimateRestoreCost`

`estimateRestoreCost(transaction)` prices the restore work a transaction would
trigger before the user signs. It inspects the transaction's ledger keys, detects
which of them are archived, and returns the extra fee the restore would add on top
of the base fee. It is the natural companion to a "this will cost extra because it
needs a restore" confirmation step.

```ts
export function estimateRestoreCost(
  transaction: Transaction,
): Promise<RestoreCostEstimate>;
```

### `RestoreCostEstimate`

| Field | Type | Meaning |
| --- | --- | --- |
| `minResourceFee` | `number` | Minimum resource fee (in stroops) the network charges for the restore operation. |
| `multiplier` | `number` | Fee multiplier applied to `minResourceFee` to derive `estimatedFee`. |
| `estimatedFee` | `number` | Total estimated restore fee (in stroops): `minResourceFee * multiplier`. |
| `archivedKeysDetected` | `PublicKey[]` | Ledger keys referenced by the transaction that are currently archived. |
| `wouldNeedRestore` | `boolean` | Whether the transaction would trigger a restore at all. |

### Zero-fee behaviour

When none of the transaction's ledger keys are archived, `wouldNeedRestore` is
`false`, `archivedKeysDetected` is empty, and `estimatedFee` is `0`. In that case
the transaction can be submitted as-is and no restore step is required — skip the
confirmation prompt entirely.

### Worked example: confirm the cost before signing

```ts
import { estimateRestoreCost } from '@handsoff/sdk';

const estimate = await estimateRestoreCost(transaction);

if (estimate.wouldNeedRestore) {
  // Surface the extra cost to the user before they sign.
  const feeInSol = estimate.estimatedFee / 1e9;
  const confirmed = await confirm({
    title: 'This transaction needs a restore',
    message:
      `${estimate.archivedKeysDetected.length} archived key(s) will be restored. ` +
      `Estimated extra fee: ${feeInSol} SOL.`,
  });

  if (!confirmed) {
    return; // User declined — do not sign or submit.
  }
} else {
  // wouldNeedRestore === false: no restore, no extra fee.
  console.log('No restore needed; estimatedFee is 0.');
}

const signed = await adapter.signTransaction(transaction);
await submit(signed);
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
