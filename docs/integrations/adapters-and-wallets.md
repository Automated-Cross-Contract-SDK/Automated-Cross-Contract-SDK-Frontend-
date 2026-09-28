# Adapters and wallets

This guide covers the wallet adapter layer: the `WalletAdapter` contract, the
`createAdapter` factory, the capability flags the SDK relies on, and the extra
setup required for hardware wallets such as Ledger and Trezor.

## The `WalletAdapter` contract

Every wallet integration implements the same `WalletAdapter` interface. The SDK
only ever talks to this interface, so a custom adapter is a first-class citizen
and behaves exactly like a built-in one.

```ts
interface WalletAdapter {
  /** Stable identifier, usually a `KnownWallet` value. */
  readonly id: string;
  /** Human-readable name shown in the UI. */
  readonly name: string;
  /** Capabilities this adapter supports. */
  readonly capabilities: WalletCapabilities;
  /** Connect and return the active account. */
  connect(): Promise<WalletAccount>;
  /** Disconnect and release any transport/resources. */
  disconnect(): Promise<void>;
  /** Sign a transaction or message payload. */
  sign(payload: SignPayload): Promise<SignedPayload>;
}
```

## The `createAdapter` factory

`createAdapter` is the public entry point for constructing an adapter. It
normalises the wallet id, validates the requested capabilities, and wires up the
correct concrete implementation (including hardware transports).

```ts
import { createAdapter, KnownWallet } from '@your-sdk/wallets';

const adapter = createAdapter({
  wallet: KnownWallet.Phantom,
  // Optional: restrict or extend the capabilities the adapter advertises.
  capabilities: { signTransaction: true, signMessage: true },
});

await adapter.connect();
const signed = await adapter.sign({ transaction });
```

### `KnownWallet` values

`KnownWallet` enumerates every wallet the SDK ships an adapter for. The same
values are exposed at runtime through `SUPPORTED_WALLETS`.

| `KnownWallet` value | Wallet | Notes |
| --- | --- | --- |
| `KnownWallet.Phantom` | Phantom | Browser extension / mobile |
| `KnownWallet.Solflare` | Solflare | Browser extension / mobile |
| `KnownWallet.Backpack` | Backpack | Browser extension |
| `KnownWallet.Glow` | Glow | Browser extension |
| `KnownWallet.Ledger` | Ledger | Hardware, requires transport + manifest |
| `KnownWallet.Trezor` | Trezor | Hardware, requires transport + manifest |

```ts
import { SUPPORTED_WALLETS } from '@your-sdk/wallets';

// Iterate every wallet the SDK can build an adapter for.
for (const wallet of SUPPORTED_WALLETS) {
  console.log(wallet.id, wallet.name, wallet.capabilities);
}
```

## Capability flags

Each adapter advertises a `capabilities` object. The SDK checks these flags
before dispatching work, so an unsupported call fails fast instead of silently
misbehaving.

| Flag | Meaning | SDK behaviour that depends on it |
| --- | --- | --- |
| `signTransaction` | Can sign transactions. | Required by `sign({ transaction })`; the SDK throws if a transaction is submitted to an adapter without it. |
| `signMessage` | Can sign arbitrary messages. | Gates `sign({ message })` and any message-based auth flow. |
| `signAndSendTransaction` | Can sign and broadcast in one step. | Enables the one-shot send path; otherwise the SDK signs then broadcasts separately. |
| `hardware` | Backed by a physical device. | Switches the SDK into hardware UX: it prompts for device confirmation and can warn about blind signing. |
| `blindSigning` | Device may sign payloads it cannot fully display. | When `hardware` is set and the payload is not fully parseable, the SDK emits a blind-signing warning before proceeding. |

## Hardware wallets

Hardware adapters (`LedgerWalletAdapter`, `TrezorWalletAdapter`) need two extra
pieces beyond a normal adapter: a **transport** to talk to the device and a
**manifest** so the device can show the requesting app to the user.

### Ledger

```bash
npm install @ledgerhq/hw-transport-webhid @ledgerhq/hw-app-solana
```

```ts
import { createAdapter, KnownWallet } from '@your-sdk/wallets';
import type { LedgerAdapterConfig } from '@your-sdk/wallets';

const config: LedgerAdapterConfig = {
  // A transport factory, e.g. WebHID in the browser.
  transport: () => TransportWebHID.create(),
  // Optional derivation path; defaults to the standard Solana path.
  derivationPath: "44'/501'/0'/0'",
};

const adapter = createAdapter({ wallet: KnownWallet.Ledger, config });
await adapter.connect();
```

### Trezor

```bash
npm install @trezor/connect-web
```

```ts
import { createAdapter, KnownWallet } from '@your-sdk/wallets';
import type { TrezorAdapterConfig } from '@your-sdk/wallets';

const config: TrezorAdapterConfig = {
  // Trezor Connect manifest is required by the device.
  manifest: {
    email: 'dev@example.com',
    appUrl: 'https://example.com',
  },
  derivationPath: "44'/501'/0'/0'",
};

const adapter = createAdapter({ wallet: KnownWallet.Trezor, config });
await adapter.connect();
```

### Latency and UX differences

Hardware signing is intentionally slower and more interactive than software
wallets:

- **Latency.** Expect roughly 1–5 seconds per signature, dominated by device
  round-trips and on-device confirmation. Software wallets typically sign in
  well under a second.
- **Confirmation.** The user must physically approve each signature on the
device. The SDK surfaces a pending state while it waits.
- **Blind signing.** If the device cannot fully display the payload, the SDK
  warns the user before signing (see the `blindSigning` capability).
- **Connection.** The transport can drop (device unplugged, tab backgrounded).
  Handle `disconnect()` and reconnect rather than assuming a persistent session.

## Custom adapters

Implement `WalletAdapter` and pass it through `createAdapter` to integrate a
wallet the SDK does not ship.

```ts
import { createAdapter, type WalletAdapter } from '@your-sdk/wallets';

const myAdapter: WalletAdapter = {
  id: 'my-wallet',
  name: 'My Wallet',
  capabilities: {
    signTransaction: true,
    signMessage: true,
    signAndSendTransaction: false,
    hardware: false,
    blindSigning: false,
  },
  async connect() {
    // Establish a session and return the active account.
    return { address: await myWallet.requestAccount() };
  },
  async disconnect() {
    await myWallet.close();
  },
  async sign(payload) {
    return myWallet.sign(payload);
  },
};

const adapter = createAdapter({ adapter: myAdapter });
```
