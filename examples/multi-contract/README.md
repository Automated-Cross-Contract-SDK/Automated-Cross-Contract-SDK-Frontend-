# Multi-Contract Example

Demonstrates interacting with **multiple independent contracts** through a
single, shared `SorobanResurrectProvider`.

Demonstrates:

- One `SorobanResurrectProvider` (one RPC connection, one restore workflow
  state machine) reused across several unrelated contract calls — archive
  detection/restoration is a network-level concern, not scoped to a single
  contract
- A reusable `ContractActionCard` component that builds and submits a
  transaction for whichever contract/function it's configured with, all via
  the same `submitWithRestore` call

## Prerequisites

- Node.js 18+
- The repo packages built: `npm install && npm run build` from the repo root
- A Freighter-compatible browser wallet with a funded testnet account

**Network:** testnet by default; override with `VITE_RPC_URL` / `VITE_NETWORK_PASSPHRASE`.

## Run

```bash
cp .env.example .env   # optional — defaults target testnet
npm run dev            # start the dev server
npm run build          # production build
npm run typecheck      # type-check only
```

Edit the `CONTRACTS` array in `src/App.tsx` to point at your own deployed contracts.
