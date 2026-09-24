# Next.js App Router Example

Integrates `@soroban-resurrect/react-hook` into a Next.js 14 App Router app.

Demonstrates:

- Wrapping the app in `SorobanResurrectProvider` from a single `'use client'`
  boundary (`app/providers.tsx`) so `app/layout.tsx` can stay a server
  component
- Reading configuration from `NEXT_PUBLIC_*` environment variables
- Consuming `useSorobanResurrectContext()` in a client component
  (`app/withdraw-card.tsx`) to submit a transaction with automatic archive
  restoration

## Running

```bash
npm install
npm run dev
```

Optionally set `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`, and
`NEXT_PUBLIC_CONTRACT_ID` in a `.env.local` file to point at your own network
and contract.
