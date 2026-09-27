# SDK API

The `@handsoff/sdk` package exposes the wallet adapter layer used by every integration.
This page documents the `WalletAdapter` contract, the `createAdapter` factory, the
`KnownWallet` / `SUPPORTED_WALLETS` registry, the capability flags, the hardware
wallet setup for Ledger and Trezor, and the N-of-M multisig restore flow.

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

```ts
import TrezorConnect from '@trezor/connect-web';
import { createAdapter, KnownWallet } from '@handsoff/sdk';

await TrezorConnect.init({
  manifest: {
    email: 'dev@example.com',
    appUrl: 'https://example.com',
  },
});

const adapter = createAdapter({
  wallet: KnownWallet.Trezor,
  config: { connect: TrezorConnect } satisfies TrezorAdapterConfig,
});
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

## Multisig restore

N-of-M restore is handled by `MultiSigWalletAdapter`, which wraps a base
`WalletAdapter` and coordinates signature collection across signers. The flow is
**build → collect → submit**: build the restore transaction, collect one signature
per signer until the threshold is met, then submit the assembled transaction.

### Sequence diagram

```mermaid
sequenceDiagram
    participant App
    participant Adapter as MultiSigWalletAdapter
    participant S1 as Signer 1
    participant S2 as Signer 2
    participant S3 as Signer 3
    participant Chain

    App->>Adapter: buildRestoreTransaction(restoreKeys)
    Adapter-->>App: restore tx (unsigned)
    App->>Adapter: collectSignatures(tx, signers)
    Adapter->>S1: signTransaction(tx)
    S1-->>Adapter: signature 1
    Adapter->>S2: signTransaction(tx)
    S2-->>Adapter: signature 2
    Note over Adapter: threshold (2) reached
    Adapter-->>App: SignatureCollectionResult
    App->>Adapter: submitWithRestore(result)
    Adapter->>Chain: submit assembled tx
    Chain-->>Adapter: confirmation
    Adapter-->>App: SignedTransaction
```

### Composing with `submitWithRestore` and `restoreKeys`

`restoreKeys` is the ordered list of public keys that make up the multisig set.
`MultiSigConfig` carries the threshold and that key list, and
`MultiSigWalletAdapter` uses it to know how many signatures are required.
`submitWithRestore` is the terminal step: it takes the
`SignatureCollectionResult` produced by the collect phase, assembles the fully
signed transaction, and submits it. You never call `submitWithRestore` before the
threshold is met — the adapter rejects an under-signed result.

### Worked 2-of-3 example

```ts
import {
  MultiSigWalletAdapter,
  MultiSigSigner,
  type MultiSigConfig,
} from '@handsoff/sdk';

const config: MultiSigConfig = {
  threshold: 2,
  restoreKeys: [signerA.publicKey, signerB.publicKey, signerC.publicKey],
};

const adapter = new MultiSigWalletAdapter({ base: baseAdapter, config });

// 1. Build the restore transaction from the multisig key set.
const tx = await adapter.buildRestoreTransaction({ restoreKeys: config.restoreKeys });

// 2. Collect signatures from each signer until the threshold is met.
const signers: MultiSigSigner[] = [signerA, signerB, signerC];
const result = await adapter.collectSignatures(tx, signers);

// 3. Submit the assembled transaction.
const submitted = await adapter.submitWithRestore(result);
```

### Failure handling

A signer may refuse to sign (user rejects the prompt, the device is unavailable,
or the signer is offline). `collectSignatures` records the refusal in the
`SignatureCollectionResult` rather than throwing immediately, so the caller can
decide how to proceed:

- If the remaining signers still reach the threshold, the result is complete and
  `submitWithRestore` succeeds.
- If a refusal drops the collected signatures below the threshold, the result is
  incomplete and `submitWithRestore` throws — surface the refusing signer to the
  user and retry collection with a replacement signer.

```ts
const result = await adapter.collectSignatures(tx, signers);

if (!result.satisfiesThreshold) {
  // e.g. signerB refused; retry with another signer from the set.
  throw new Error(`Need ${config.threshold} signatures, got ${result.signatures.length}`);
}

await adapter.submitWithRestore(result);
```
