# xBull

[`@soroban-resurrect/adapter-xbull`](https://www.npmjs.com/package/@soroban-resurrect/adapter-xbull)
integrates the xBull browser extension with the SDK's `WalletAdapter`
interface.

## Install

```bash
npm install @soroban-resurrect/adapter-xbull @soroban-resurrect/sdk
```

## Connect and sign

```ts
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { XBullAdapter } from '@soroban-resurrect/adapter-xbull'

const wallet = new XBullAdapter()
const account = await wallet.getPublicKey()
const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
})

const result = await sr.submitWithRestore({ transaction, wallet })
```

`getPublicKey()` connects to xBull and caches the selected account.
`isConnected()` reflects that adapter-local connection; `disconnect()` clears
the cached account so subsequent signing requires reconnecting.

Pass `networkPassphrase` to select the Stellar network. Alternatively,
`network: 'testnet'`, `'public'`, or `'mainnet'` maps to the corresponding
Stellar passphrase. Supplying inconsistent options, or an unsupported network
identifier, fails with `WalletError` code `NETWORK_MISMATCH` before signing.
Connection and signing failures use `USER_REJECTED`, `NOT_CONNECTED`,
`NETWORK_MISMATCH`, or `UNKNOWN`; branch on `error.code` rather than parsing
messages.

The adapter supports full transaction and fee-bump signing. CAP-0046
authorization-entry signing is not supported.
