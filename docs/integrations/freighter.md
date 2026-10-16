# Freighter

[`@soroban-resurrect/adapter-freighter`](https://www.npmjs.com/package/@soroban-resurrect/adapter-freighter)
integrates the Freighter browser extension with the SDK's `WalletAdapter`
interface.

## Install

```bash
npm install @soroban-resurrect/adapter-freighter @soroban-resurrect/sdk
```

## Connect and sign

```ts
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { FreighterAdapter } from '@soroban-resurrect/adapter-freighter'

const wallet = new FreighterAdapter()
const account = await wallet.getPublicKey()
const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
})

const result = await sr.submitWithRestore({ transaction, wallet })
```

`getPublicKey()` requests account access from Freighter. `isConnected()` reflects
the extension's connection state. The adapter passes the supplied
`networkPassphrase` to Freighter and parses the response as a Stellar transaction
envelope before returning it as `XdrBase64`.

Connection and signing failures are thrown as `WalletError`s. `USER_REJECTED`
identifies denied prompts, `NOT_CONNECTED` identifies missing account access,
`NETWORK_MISMATCH` identifies network errors, and `UNKNOWN` covers other wallet
failures or malformed/missing signing results. Branch on `error.code` rather
than parsing messages.

The adapter supports transaction, fee-bump, and CAP-0046 authorization-entry
signing. Its reported capabilities are `{ signAuthEntry: true, feeBump: true,
hardware: false }`.
