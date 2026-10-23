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

## Vue application example

The `examples/vue` sample application wires the Vue composable to a wallet and
demonstrates the connection lifecycle. It is a reference for the stable
`useWallet` interface exposed by `@soroban-resurrect/vue`.

```ts
import { useWallet } from '@soroban-resurrect/vue'

const {
  status, // 'idle' | 'connecting' | 'connected' | 'rejected' | 'error'
  publicKey,
  error,
  connect,
  disconnect,
} = useWallet({ adapter: 'freighter' })
```

The composable exposes a documented, stable interface:

- `status` — reactive connection state (`idle`, `connecting`, `connected`,
  `rejected`, `error`).
- `publicKey` — the connected account, or `null` when not connected.
- `error` — the last failure, or `null`.
- `connect()` — starts the connection flow; resolves once the wallet responds.
- `disconnect()` — clears the connection and resets `status` to `idle`.

The example renders each state explicitly:

- **Loading** — shown while `status === 'connecting'`.
- **Rejection** — shown when the user declines in the wallet
  (`status === 'rejected'`), with a retry action.
- **Restore success** — shown when a previously connected session is restored
  on mount (`status === 'connected'` with a restored `publicKey`).
- **Failure** — shown when the adapter throws (`status === 'error'`), including
  the `error` message and a retry action.

Run the example with `npm install && npm run dev` inside `examples/vue`. The
composable requires the same `@soroban-resurrect/adapter-*` package as the
underlying adapter; see [Browser wallets](#browser-wallets).
