# Adapters and wallets

The SDK accepts a `WalletAdapter` for account lookup and transaction signing.
Browser adapters are loaded on demand; Ledger and Trezor adapters are included
in the SDK and accept their transport/client as configuration.

## Browser wallets

`createAdapter` accepts `freighter`, `albedo`, `lobstr`, `xbull`, `rabet`,
`walletconnect`, `walletkit`, `ledger`, or `trezor`. Browser-wallet adapters
are published as separate `@soroban-resurrect/adapter-*` packages and must be
installed by applications that use them.

```ts
import { createAdapter } from '@soroban-resurrect/sdk'

const wallet = await createAdapter('freighter')
const publicKey = await wallet.getPublicKey()
```

## Scaffolder wallet selection

The scaffolder (`create-soroban-resurrect-app`) can generate a project wired to
a supported wallet integration. Pass `--wallet <name>` to select one
non-interactively, or omit it to be prompted. Supported values are `freighter`
and `rabet`; any other value fails fast with a non-zero exit code and a message
listing the supported wallets.

```sh
npx create-soroban-resurrect-app my-app --wallet freighter
```

When a wallet is selected, the generated project includes:

- a wallet module that instantiates the matching adapter via `createAdapter`,
- a `.env.example` with the environment variables the integration expects,
- a `WALLET_SETUP.md` with install and configuration steps for that wallet.

### Freighter

```sh
npm install @soroban-resurrect/adapter-freighter
```

```sh
# .env.example
VITE_WALLET=freighter
VITE_STELLAR_NETWORK=testnet
```

Install the [Freighter](https://www.freighter.app/) browser extension, switch it
to the network matching `VITE_STELLAR_NETWORK`, and fund the account before
connecting.

### Rabet

```sh
npm install @soroban-resurrect/adapter-rabet
```

```sh
# .env.example
VITE_WALLET=rabet
VITE_STELLAR_NETWORK=testnet
```

Install the [Rabet](https://rabet.io/) browser extension, switch it to the
network matching `VITE_STELLAR_NETWORK`, and fund the account before connecting.

### Migration notes

Projects scaffolded before wallet selection was added have no `VITE_WALLET`
entry. Add it (and the matching adapter dependency) to opt into the generated
wallet module; existing custom adapters continue to work unchanged.

## Hardware wallets

Both hardware adapters declare `hardware: true`, `feeBump: true`, and
`signAuthEntry: false`. They do not advertise `maxOperations`: the SDK has no
reliable operation ceiling that applies to all supported device app and
firmware versions.

### Ledger

Install the Ledger transport and Stellar app packages:

```sh
npm install @ledgerhq/hw-transport-webusb @ledgerhq/hw-app-str
```

```ts
import TransportWebUSB from '@ledgerhq/hw-transport-webusb'
import { createLedgerAdapter } from '@soroban-resurrect/sdk'

const transport = await TransportWebUSB.create()
const wallet = createLedgerAdapter({ transport, accountIndex: 0 })
await wallet.connect()
```

The adapter derives `m/44'/148'/accountIndex'`. It requests signing in the
Ledger Stellar app and requires physical confirmation. It supports plain and
fee-bump envelopes, but not CAP-0046 authorization-entry signing.

### Trezor

Install Trezor Connect and provide its required application manifest:

```sh
npm install @trezor/connect-web
```

```ts
import TrezorConnect from '@trezor/connect-web'
import { createTrezorAdapter } from '@soroban-resurrect/sdk'

const wallet = createTrezorAdapter({
  trezorConnect: TrezorConnect,
  manifest: {
    email: 'dev@example.com',
    appUrl: 'https://example.com',
  },
  accountIndex: 0,
})
await wallet.connect()
```

The adapter derives `m/44'/148'/accountIndex'/0/0`. It requests signing through
Trezor Connect and requires physical confirmation. It supports plain and
fee-bump envelopes, but not CAP-0046 authorization-entry signing.

### Transaction display limitations

The SDK logs a warning through the configured `logger` before asking a
hardware wallet to sign: transaction details may not be fully verifiable on
the device.

| Device | Signing prompt and display limits |
| --- | --- |
| Ledger Stellar app | This adapter sends the transaction hash to `signHash`; it does not send the operation or memo fields for the device to display. Users must verify transaction details in the trusted application before approving. |
| Trezor via Trezor Connect | The adapter passes the transaction envelope to Trezor Connect, which presents the fields supported by the installed firmware. The complete Soroban restore footprint and ledger keys are not guaranteed to be inspectable on-device. |

Prompts and supported fields vary with device app/firmware versions.

Restore transactions signed by a hardware wallet include the configured
`restoreTxMemo` or `restoreTxMemoText`. If neither is set, the SDK attaches the
short text memo `Restore archived entries`. Trezor may display the memo when
supported by the installed firmware; the Ledger hash-signing flow does not
display memo fields. The memo remains part of the transaction and is limited
to 28 UTF-8 bytes.

## Custom adapters

An adapter implements account lookup and transaction signing. Capabilities
describe optional features the SDK may rely on:

```ts
import type { WalletAdapter } from '@soroban-resurrect/sdk'

const wallet: WalletAdapter = {
  isConnected: async () => true,
  getPublicKey: async () => 'G...',
  signTransaction: async (xdr, options) => signWithMyWallet(xdr, options),
  capabilities: {
    hardware: false,
    feeBump: false,
    signAuthEntry: false,
  },
}
```

Set `hardware: true` for physical signing devices so the SDK can issue the
hardware-signing warning. Only set `feeBump` or `signAuthEntry` when the
adapter actually supports those envelope/signing modes.
