# Albedo

[`@soroban-resurrect/adapter-albedo`](https://www.npmjs.com/package/@soroban-resurrect/adapter-albedo)
integrates the Albedo web wallet with the SDK's `WalletAdapter` interface.

## Install

```bash
npm install @soroban-resurrect/adapter-albedo @soroban-resurrect/sdk
```

## Connect and sign

```ts
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { AlbedoAdapter } from '@soroban-resurrect/adapter-albedo'

const wallet = new AlbedoAdapter()
const account = await wallet.getPublicKey()
const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
})

const result = await sr.submitWithRestore({ transaction, wallet })
```

`getPublicKey()` opens Albedo's account selection flow. `isConnected()` reports
whether this adapter instance has retrieved an account; Albedo does not expose a
disconnect API through `@albedo-link/intent`.

## Network and errors

`signTransaction(xdr, options)` forwards `network` (defaulting to `testnet`) and
an optional `networkPassphrase` to Albedo, and sets `submit: false` so the SDK
remains responsible for submission. Connection and signing failures are thrown
as `WalletError`s: `USER_REJECTED` for denied prompts, `NETWORK_MISMATCH` for
network errors, `NOT_CONNECTED` when the wallet/account is unavailable, and
`UNKNOWN` for other wallet failures or missing signing results. Check `error.code`
instead of parsing messages.

The adapter supports full transaction and fee-bump signing. CAP-0046
authorization-entry signing is not supported.
