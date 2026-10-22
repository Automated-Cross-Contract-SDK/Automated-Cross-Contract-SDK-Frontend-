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

## Scaffolder setup

When generating a project with the scaffolder, select Freighter as the wallet
integration to get matching setup guidance and environment examples:

```bash
npx @soroban-resurrect/scaffolder my-app --wallet freighter
```

Supported wallet integrations are `freighter` and `rabet`. Omitting `--wallet`
keeps the default (no wallet integration) and generates no wallet-specific
files. Passing an unsupported value fails with a clear error listing the
supported integrations.

Selecting `freighter` generates a `.env.example` entry and a short setup note
in the generated project's README:

```bash
# .env.example
VITE_WALLET_INTEGRATION=freighter
```

Install the Freighter browser extension, then follow the adapter usage above to
connect and sign. The generated project reads `VITE_WALLET_INTEGRATION` to pick
the wallet adapter at runtime.

### Migration notes

Projects generated before wallet selection was added have no
`VITE_WALLET_INTEGRATION` entry. Add it manually (or re-run the scaffolder into
a fresh directory) and install the matching adapter package. Existing projects
that do not set the variable continue to run without a wallet integration.
