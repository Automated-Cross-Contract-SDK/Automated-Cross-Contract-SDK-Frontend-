# Rabet

[`@soroban-resurrect/adapter-rabet`](https://www.npmjs.com/package/@soroban-resurrect/adapter-rabet)
integrates the [Rabet](https://rabet.io) browser extension (`window.rabet`) with
the SDK's `WalletAdapter` interface.

## Install

```bash
npm install @soroban-resurrect/adapter-rabet
```

## Usage

```ts
import { RabetAdapter } from '@soroban-resurrect/adapter-rabet'

const wallet = new RabetAdapter()
const account = await wallet.getPublicKey()
const result = await sr.submitWithRestore({ transaction, wallet })

// or, via the factory:
const wallet2 = await createAdapter('rabet')
```

`getPublicKey()` opens Rabet's connection prompt. `isConnected()` checks the
extension's optional `isUnlocked()` state when available, otherwise it reflects
the account cached by this adapter instance. `disconnect()` clears that cached
account and calls Rabet's optional disconnect method.

## Constructor options

| Option  | Type       | Default        | Description                                              |
| ------- | ---------- | -------------- | -------------------------------------------------------- |
| `rabet` | `RabetApi` | `window.rabet` | Override the Rabet API object (tests, custom injection). |

No environment variables are required.

`signTransaction(xdr, options)` maps `network: 'public' | 'mainnet'` or the
public network passphrase to Rabet's `mainnet` identifier. `network: 'testnet'`
or the testnet passphrase maps to `testnet`; the testnet is the default.
Unsupported networks are rejected with `WalletError` code `NETWORK_MISMATCH`
rather than silently signing on the wrong network.

Connection and signing failures are reported as structured `WalletError`s:
`USER_REJECTED`, `NOT_CONNECTED`, `NETWORK_MISMATCH`, or `UNKNOWN`. Check
`error.code` rather than parsing the message.

## SSR / browser constraints

The adapter reads `window.rabet` when constructed in a browser, so create it only
in a client-only component (e.g. inside `useEffect` or `onMounted`). On the
server — or when the extension is not installed — adapter operations fail with
`WalletError` code `NOT_CONNECTED` unless a `rabet` instance is passed.

Capabilities are `{ signAuthEntry: false, feeBump: true, hardware: false }`.
Rabet does not implement CAP-0046 authorization-entry signing; the SDK can
therefore reject that operation through capability checks before prompting the
wallet.
