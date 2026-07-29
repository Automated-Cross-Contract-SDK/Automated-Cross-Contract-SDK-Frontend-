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

## Running

```bash
npm install
npm run dev
```

Edit the `CONTRACTS` array in `src/App.tsx` to point at your own deployed
contracts.
