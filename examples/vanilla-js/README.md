# Vanilla JS Example

Plain JavaScript usage of `@soroban-resurrect/sdk` — no framework, no React.

Demonstrates:

- Constructing a `SorobanResurrect` instance directly
- Subscribing to workflow state changes with `onStateChange`
- Calling `submitWithRestore` with a hand-rolled `WalletAdapter` for the
  Freighter browser extension
- Rendering UI updates with plain DOM APIs

## Prerequisites

- Node.js 18+
- The repo packages built: `npm install && npm run build` from the repo root
- The [Freighter](https://www.freighter.app/) browser extension with a funded testnet account

**Network:** testnet by default; override with `VITE_RPC_URL` / `VITE_NETWORK_PASSPHRASE` / `VITE_CONTRACT_ID`.

## Run

```bash
cp .env.example .env   # optional — defaults target testnet
npm run dev            # start the dev server
npm run build          # production build
npm run typecheck      # type-check only
```

Open the printed local URL and click "Connect Freighter Wallet" followed by "Submit Withdraw".
