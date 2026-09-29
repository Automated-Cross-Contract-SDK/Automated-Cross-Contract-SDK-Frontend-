# Examples

Sample applications showing how to integrate `@soroban-resurrect/sdk` and
`@soroban-resurrect/react-hook` in different environments. Each example is
self-contained — see its own `README.md` for setup instructions.

| Example                              | Demonstrates                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic`](./basic)                   | Minimal Vite + React integration using `SorobanResurrectProvider` and `useSorobanResurrectContext`.                                                                                |
| [`vanilla-js`](./vanilla-js)         | Plain JavaScript usage of `@soroban-resurrect/sdk` directly — no framework.                                                                                                        |
| [`nextjs-app`](./nextjs-app)         | Next.js App Router integration: server-side `needsRestore()` detection in a Server Component, with the provider and restore flow isolated behind a single `'use client'` boundary. |
| [`react-native`](./react-native)     | React Native mobile integration, including the Node polyfills the SDK needs on-device.                                                                                             |
| [`multi-contract`](./multi-contract) | Interacting with multiple independent contracts through one shared `SorobanResurrectProvider`.                                                                                     |
| [`node-worker`](./node-worker)       | Server-side maintenance: a cron-style Node.js script that scans a contract with `getExpiringEntriesForContract` and restores via `restoreKeys` with a signing-key `WalletAdapter`. |
| [`walletconnect`](./walletconnect)   | Pairing a mobile wallet over WalletConnect v2 (`adapter-walletconnect`), session connect/disconnect/expiry, then detect and restore.                                                |

All examples are npm workspaces, so `@soroban-resurrect/sdk` and
`@soroban-resurrect/react-hook` resolve to this repo's `packages/*` sources.
Build the packages first from the repo root:

```bash
npm install
npm run build:sdk
npm run build:hook
```

Then `cd` into any example directory and follow its README.

Every example exposes the same scripts and ships a `.env.example`:

| Script              | Purpose                               |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Run locally (dev server / worker)     |
| `npm run build`     | Production build                      |
| `npm run typecheck` | Type-check against the workspace packages |

All examples target **testnet** by default. CI runs `typecheck` for every
example against the current `packages/*` so they cannot silently drift from
the published API.
