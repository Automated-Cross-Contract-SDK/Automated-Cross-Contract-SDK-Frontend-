# Basic Example

Minimal Vite + React integration of `@soroban-resurrect/react-hook`.

Demonstrates:

- Wrapping the app in `SorobanResurrectProvider`
- Consuming `useSorobanResurrectContext()` to submit a transaction with automatic restore
- A network selector and progress / error display components

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

Open the printed local URL, connect Freighter and submit the demo transaction.
