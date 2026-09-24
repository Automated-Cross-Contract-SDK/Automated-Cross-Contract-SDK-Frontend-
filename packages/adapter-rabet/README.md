# @soroban-resurrect/adapter-rabet

[`WalletAdapter`](../sdk) implementation for the [Rabet](https://rabet.io) Stellar
browser extension wallet.

Rabet exposes a browser-API surface similar to Freighter's through the global
`window.rabet` object. This adapter wraps it and follows the same conventions as
the other adapter packages (`asStellarPublicKey` / `asXdrBase64`, error
normalization, `capabilities` flags).

## Install

```bash
npm install @soroban-resurrect/adapter-rabet @soroban-resurrect/sdk
```

The user must also have the [Rabet extension](https://rabet.io) installed in
their browser.

## Usage

```ts
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { RabetAdapter } from '@soroban-resurrect/adapter-rabet'

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })
const wallet = new RabetAdapter()

// Triggers the Rabet connect popup and caches the public key.
const address = await wallet.getPublicKey()

const result = await sr.submitWithRestore({ transaction, wallet })
```

### Passing a custom API object

Useful for tests or non-browser environments:

```ts
const wallet = new RabetAdapter({ rabet: myRabetLikeObject })
```

## API

| Member | Description |
| --- | --- |
| `isConnected()` | `true` once `getPublicKey()` has run, or when `rabet.isUnlocked()` reports an unlocked wallet. |
| `getPublicKey()` | Calls `rabet.connect()`, caches and returns the account as a `StellarPublicKey`. |
| `signTransaction(xdr, opts)` | Calls `rabet.sign(xdr, network)` where `network` is derived from `opts.networkPassphrase` (defaults to testnet). Returns the signed envelope as `XdrBase64`. |
| `capabilities` | `{ signAuthEntry: false, feeBump: true, hardware: false }` |

## Capabilities

Rabet signs full transaction envelopes (including fee-bump envelopes). It does
not expose CAP-0046 per-entry signing, so `capabilities.signAuthEntry` is
`false` and the SDK will not attempt the auth-entry path with this wallet.
