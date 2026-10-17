# Freighter adapter

`@soroban-resurrect/adapter-freighter` adapts the Freighter browser extension
to the SDK's `WalletAdapter` interface.

```bash
npm install @soroban-resurrect/adapter-freighter @soroban-resurrect/sdk
```

```typescript
import { FreighterAdapter } from '@soroban-resurrect/adapter-freighter'

const wallet = new FreighterAdapter()
if (!(await wallet.isConnected())) {
  const publicKey = await wallet.getPublicKey() // Prompts for account access.
  console.log('Connected account:', publicKey)
}

const networkPassphrase = await wallet.getNetwork()
const signedXdr = await wallet.signTransaction(transactionXdr, {
  networkPassphrase,
})
```

## Network selection

Choose the network in Freighter's own network selector; Freighter API v3 does
not expose a programmatic network-switch method. `getNetwork()` returns the
currently selected network passphrase. When `signTransaction` receives a
`networkPassphrase` or `network` option, it verifies the selected network before
asking the wallet to sign and throws `WalletError` with code
`NETWORK_MISMATCH` if they differ. The `network` option accepts Freighter's
network label (such as `testnet` or `public`), the `mainnet` alias, or the
selected passphrase.

## Signing and user rejection

`signTransaction` forwards the selected account address and network passphrase
to Freighter. `signAuthEntry` is also available on the class and accepts
`networkPassphrase` and `address` options.

Access or signing requests rejected by the user throw `WalletError` with code
`USER_REJECTED`. Other Freighter failures are normalized to `NOT_CONNECTED`,
`NETWORK_MISMATCH`, or `UNKNOWN` where their messages identify those cases.
