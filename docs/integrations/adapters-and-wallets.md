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
  readonly capabilities?: WalletCapabilities;
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string>;
  signAuthEntry?(
    authEntryXdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<string>;
}
```

## The `createAdapter` factory

`createAdapter` lazily loads a browser adapter or constructs a hardware adapter.
The returned promise resolves to a ready-to-connect `WalletAdapter`.

```ts
import { createAdapter } from '@soroban-resurrect/sdk';

const adapter = await createAdapter('freighter');

const publicKey = await adapter.getPublicKey();
const signedXdr = await adapter.signTransaction(transaction.toXDR(), {
  networkPassphrase,
});
```

### `KnownWallet` values

`KnownWallet` is a string union of every adapter the SDK can load. The same
values are exposed at runtime through `SUPPORTED_WALLETS`.

## Wallet compatibility matrix

All adapters sign complete Stellar transaction envelopes with
`signTransaction`. CAP-0046 authorization-entry signing is only available where
the table says so. A wallet's own network selection must match the SDK's
`networkPassphrase`; only adapters that explicitly accept and use that option
can pass it through to the wallet.

| Wallet / adapter | Signing behavior and required options | Known limitations | Tested adapter / provider API version |
| --- | --- | --- | --- |
| Freighter (`freighter`) | Signs envelopes and supports `signAuthEntry`; accepts `networkPassphrase`. No constructor options. | Does not submit transactions; the app submits the returned signed XDR. Its `network` option is not used. | Adapter `0.1.0`; `@stellar/freighter-api` `3.1.0` (mocked API tests). |
| xBull (`xbull`) | Signs envelopes; connect before signing. For signing, `networkPassphrase` is forwarded as the connector's `network`. | No CAP-0046 signing. The separate `network` option is ignored. | Adapter `0.1.0`; `@creit.tech/xbull-wallet-connect` `0.4.0` (mocked API tests). |
| Albedo (`albedo`) | Signs envelopes; no constructor options. Accepts `network` (defaults to `testnet`) and `networkPassphrase`. | No CAP-0046 signing. Configure `network` for the Albedo network and keep it consistent with the SDK passphrase. | Adapter `0.1.0`; `@albedo-link/intent` `0.11.2` (mocked API tests). |
| LOBSTR (`lobstr`) | Signs envelopes; connect the extension and select the target network there. | The signer API accepts only XDR, so the adapter cannot forward network options. No CAP-0046 signing. | Adapter `0.1.0`; `@lobstrco/signer-extension-api` `2.1.0` (mocked API tests). |
| Rabet (`rabet`) | Signs envelopes; accepts an optional injected `rabet` API for non-browser use and tests. | Maps the public-network passphrase to Rabet's `mainnet`; all other passphrases map to `testnet` (no Futurenet distinction). No CAP-0046 signing. | Adapter `0.1.0`; injected API mock (Rabet extension version is not pinned). |
| WalletConnect (`walletconnect`) | Signs envelopes with `stellar_signXDR`; requires an approved `client`, `session`, and `networkPassphrase`. The session must grant an account on the matching Stellar chain. | Supports Testnet and Public only; no Futurenet mapping, CAP-0046 signing, or adapter-managed pairing lifecycle. | Adapter `0.1.0`; structural mocked client (WalletConnect SignClient version is app-selected). |
| Stellar Wallets Kit (`walletkit`) | Signs envelopes through the currently selected Kit signer; requires a configured `kit` instance. | No CAP-0046 signing. Hardware support depends on the selected signer. The app owns wallet selection and Kit setup. | Adapter `0.1.0`; `@creit.tech/stellar-wallets-kit` peer `>=1.0.0` (no pinned version). |
| Ledger (`ledger`) | Signs envelopes on-device; requires a transport and a connected Stellar app. `accountIndex` defaults to `0`; `networkPassphrase` defaults to Testnet. | No CAP-0046 signing. Requires `@ledgerhq/hw-app-str` and a compatible transport supplied by the app; physical confirmation is required. | SDK adapter `0.1.0`; optional device packages are app-supplied and not pinned. |
| Trezor (`trezor`) | Signs envelopes on-device; requires `trezorConnect` and a manifest (`email`, `appUrl`). `accountIndex` defaults to `0`; `networkPassphrase` defaults to Testnet. | No CAP-0046 signing. Requires `@trezor/connect-web` (or compatible Connect instance); physical confirmation is required. | SDK adapter `0.1.0`; optional Connect package is app-supplied and not pinned. |

The provider versions above are the versions in this repository's lockfile at
the time of testing. Adapter tests use mocked APIs; CI does not claim to test
specific browser-extension releases, mobile wallet releases, device firmware,
or hardware transports. Pin and test those separately in the consuming app.
`walletkit` and `walletconnect` are optional integration layers and do not
install or select a wallet provider on the application's behalf.

```ts
import { SUPPORTED_WALLETS } from '@your-sdk/wallets';

// Iterate every wallet the SDK can build an adapter for.
for (const wallet of SUPPORTED_WALLETS) {
  console.log(wallet);
}
```

## Capability flags

Each adapter advertises a `capabilities` object. The SDK uses
`signAuthEntry`, `feeBump`, and `hardware` to select or reject workflow paths.
An omitted flag means the adapter does not declare that capability.

| Flag | Meaning | SDK behavior |
| --- | --- | --- |
| `signAuthEntry` | Can sign CAP-0046 authorization entries. | Enables address-credential signing when the simulated transaction requires it. |
| `feeBump` | Can sign a fee-bump envelope. | Required when `feeBumpConfig` is supplied to the workflow. |
| `hardware` | Signs through a physical device. | Identifies adapters that require device interaction; the adapter does not infer blind-signing support. |

## Hardware wallets

Hardware adapters (`LedgerWalletAdapter`, `TrezorWalletAdapter`) need two extra
pieces beyond a normal adapter: a **transport** to talk to the device and a
**manifest** so the device can show the requesting app to the user.

### Ledger

```bash
npm install @ledgerhq/hw-transport-webusb @ledgerhq/hw-app-str
```

```ts
import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import { createAdapter } from '@soroban-resurrect/sdk';

const transport = await TransportWebUSB.create();
const adapter = await createAdapter('ledger', { transport, accountIndex: 0 });
await adapter.connect();
```

### Trezor

```bash
npm install @trezor/connect-web
```

```ts
import TrezorConnect from '@trezor/connect-web';
import { createAdapter } from '@soroban-resurrect/sdk';

const adapter = await createAdapter('trezor', {
  trezorConnect: TrezorConnect,
  manifest: {
    email: 'dev@example.com',
    appUrl: 'https://example.com',
  },
  accountIndex: 0,
});
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
- **Transaction display.** Device display and blind-signing behavior depend on
  the installed Stellar app, firmware, and transaction contents; verify the
  current device behavior before production use.
- **Connection.** The transport can drop (device unplugged, tab backgrounded).
  Handle `disconnect()` and reconnect rather than assuming a persistent session.

## Custom adapters

Implement `WalletAdapter` to integrate a wallet the SDK does not ship, then
pass that instance to `submitWithRestore`.

```ts
import type { WalletAdapter } from '@soroban-resurrect/sdk';

const myAdapter: WalletAdapter = {
  capabilities: {
    signAuthEntry: false,
    feeBump: false,
    hardware: false,
  },
  async isConnected() {
    return myWallet.isConnected();
  },
  async getPublicKey() {
    return myWallet.getPublicKey();
  },
  async signTransaction(tx, opts) {
    return myWallet.signTransaction(tx, opts);
  },
};

await sr.submitWithRestore({ transaction, wallet: myAdapter });
```
