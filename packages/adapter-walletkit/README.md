# @soroban-resurrect/adapter-walletkit

[`WalletAdapter`](../sdk) implementation that wraps Stellar's official
[`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
(the "Kit").

The Kit is the de-facto standard for dApps that want to support many wallets at
once. With this adapter, **every wallet the Kit can connect to** — Freighter,
xBull, Albedo, LOBSTR, Rabet, Ledger, WalletConnect, … — gains the SDK's
automatic archive-restore support for free. Signing is delegated to whichever
signer the Kit currently has selected.

## Install

```bash
npm install @soroban-resurrect/adapter-walletkit @creit.tech/stellar-wallets-kit @soroban-resurrect/sdk
```

`@creit.tech/stellar-wallets-kit` is a peer dependency — you own its version and
configuration.

## dApp integration

```ts
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  allowAllModules,
} from '@creit.tech/stellar-wallets-kit'
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { WalletKitAdapter } from '@soroban-resurrect/adapter-walletkit'

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: allowAllModules(),
})

// Let the user choose a wallet (or call kit.setWallet(id) directly).
await kit.openModal({
  onWalletSelected: (wallet) => kit.setWallet(wallet.id),
})

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })
const wallet = new WalletKitAdapter({ kit })

const result = await sr.submitWithRestore({ transaction, wallet })
```

### Multiple signers

The adapter never pins a wallet. Call `kit.setWallet(newId)` at any time and the
next `getPublicKey()` / `signTransaction()` call goes through the newly-selected
signer.

## API

| Member | Description |
| --- | --- |
| `isConnected()` | `true` once an address has been resolved, or when `kit.getAddress()` succeeds. |
| `getPublicKey()` | Delegates to `kit.getAddress()`, caches and returns a `StellarPublicKey`. |
| `signTransaction(xdr, opts)` | Delegates to `kit.signTransaction(xdr, { address, networkPassphrase })`, returns the signed envelope as `XdrBase64`. |
| `capabilities` | `{ signAuthEntry: false, feeBump: true }` (`hardware` is left unknown — it depends on the selected wallet). |

## Capabilities

The Kit's `signTransaction` surface signs full transaction envelopes (fee-bump
included) but does not expose CAP-0046 per-entry signing, so
`capabilities.signAuthEntry` is `false`. `hardware` is intentionally left unset
because whether the active signer is a hardware device depends on the user's
choice in the Kit.
