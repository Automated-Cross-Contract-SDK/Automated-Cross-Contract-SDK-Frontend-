# Stellar Wallets Kit

Adapter wrapping [`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit).
Every wallet the Kit supports (Freighter, xBull, Albedo, LOBSTR, Rabet, WalletConnect, …) becomes
usable with the SDK through one adapter; signing is delegated to the Kit's selected wallet.

## Install

```bash
npm install @soroban-resurrect/adapter-walletkit @creit.tech/stellar-wallets-kit
```

## Usage

```ts
import { StellarWalletsKit, WalletNetwork, FREIGHTER_ID, allowAllModules } from '@creit.tech/stellar-wallets-kit'
import { WalletKitAdapter } from '@soroban-resurrect/adapter-walletkit'

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: allowAllModules(),
})
await kit.openModal({ onWalletSelected: (w) => kit.setWallet(w.id) })

const wallet = new WalletKitAdapter({ kit })
const result = await sr.submitWithRestore({ transaction, wallet })
```

## Constructor options

| Option | Type                    | Required | Description                                                          |
| ------ | ----------------------- | -------- | -------------------------------------------------------------------- |
| `kit`  | `StellarWalletsKitLike` | ✅       | A configured Kit; call `kit.setWallet(...)` (or use its modal) before signing. |

No environment variables are required by the adapter itself. If you enable the Kit's
WalletConnect module, it needs a WalletConnect project ID — see [WalletConnect](./walletconnect.md).

## SSR / browser constraints

The Kit touches browser extensions and `window`, so create it (and the adapter) client-side only.

Capabilities: `signAuthEntry: false`, `feeBump: true`.
