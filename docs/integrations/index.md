# Integrations

Framework guides: [React](./react.md) · [Next.js](./nextjs.md) · [Vite](./vite.md) · [Astro](./astro.md).
Adapter concepts: [Adapters and Wallets](./adapters-and-wallets.md).

## Adapter matrix

Every wallet below is listed in `SUPPORTED_WALLETS` and resolved by `createAdapter(name)`.
All adapters sign transactions; the columns are the `WalletCapabilities` flags.

| Wallet (`KnownWallet`) | Package / export                                                  | `signAuthEntry` | `feeBump` | `hardware` | Guide                              |
| ---------------------- | ----------------------------------------------------------------- | --------------- | --------- | ---------- | ---------------------------------- |
| `freighter`            | `@soroban-resurrect/adapter-freighter` · `FreighterAdapter`         | ✅              | ✅        | —          | [Adapters](./adapters-and-wallets.md) |
| `albedo`               | `@soroban-resurrect/adapter-albedo` · `AlbedoAdapter`               | —               | ✅        | —          | [Adapters](./adapters-and-wallets.md) |
| `lobstr`               | `@soroban-resurrect/adapter-lobstr` · `LobstrAdapter`               | —               | ✅        | —          | [Adapters](./adapters-and-wallets.md) |
| `xbull`                | `@soroban-resurrect/adapter-xbull` · `XBullAdapter`                 | —               | ✅        | —          | [Adapters](./adapters-and-wallets.md) |
| `rabet`                | `@soroban-resurrect/adapter-rabet` · `RabetAdapter`                 | —               | ✅        | —          | [Rabet](./rabet.md)                |
| `walletconnect`        | `@soroban-resurrect/adapter-walletconnect` · `WalletConnectAdapter` | —               | ✅        | —          | [WalletConnect](./walletconnect.md) |
| `walletkit`            | `@soroban-resurrect/adapter-walletkit` · `WalletKitAdapter`         | —               | ✅        | —          | [Wallets Kit](./walletkit.md)      |
| `ledger`               | `@soroban-resurrect/sdk` · `createLedgerAdapter`                    | —               | ✅        | ✅         | [Adapters](./adapters-and-wallets.md) |
| `trezor`               | `@soroban-resurrect/sdk` · `createTrezorAdapter`                    | —               | ✅        | ✅         | [Adapters](./adapters-and-wallets.md) |
