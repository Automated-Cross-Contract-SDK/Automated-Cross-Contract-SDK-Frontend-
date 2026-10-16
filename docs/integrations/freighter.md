# Freighter wallet

Install the typed adapter and SDK:

```bash
npm install @soroban-resurrect/adapter-freighter @soroban-resurrect/sdk
```

`getPublicKey()` requests account access when needed. The adapter can then sign
transactions using the network selected in the Freighter extension:

```typescript
import { FreighterAdapter } from '@soroban-resurrect/adapter-freighter'

const wallet = new FreighterAdapter()
const publicKey = await wallet.getPublicKey()
const selectedPassphrase = await wallet.getNetwork()

const signedXdr = await wallet.signTransaction(transactionXdr, {
  networkPassphrase: selectedPassphrase,
})
```

## Network selection

Select the network in Freighter's network selector. Freighter API v3 does not
provide a programmatic network-switch operation, so the adapter does not change
the extension's setting. `getNetwork()` reports its current passphrase.
`signTransaction` checks a supplied `networkPassphrase` against that selection
before calling Freighter; the optional `network` value may be a Freighter network
label such as `testnet` or `public`, the `mainnet` alias, or the passphrase
itself. A mismatch throws `WalletError` with code `NETWORK_MISMATCH`.

Without either network option, Freighter signs on its currently selected
network. Supplying the passphrase from the SDK's active network is recommended
to prevent accidental cross-network signing.

## Signing and errors

Transaction signing passes both the expected passphrase and selected account
address to Freighter. The adapter also supports `signAuthEntry` with explicit
`networkPassphrase` and `address` options.

If the user declines account access or a signature, the adapter throws
`WalletError` with code `USER_REJECTED`. Missing permissions or connectivity
are reported as `NOT_CONNECTED`; unclassified wallet errors use `UNKNOWN`.
