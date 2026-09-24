# Next.js App Router Example

Integrates `@soroban-resurrect/sdk` and `@soroban-resurrect/react-hook` into a
Next.js 14 App Router app, split across the server/client boundary the way the
App Router intends.

Demonstrates:

- A **Server Component** (`app/server-restore-status.tsx`) that calls
  `needsRestore()` and `estimateRestoreCost()` against a **server-only** RPC
  endpoint, then passes `needsRestore` (and the fee estimate) down as props
- A **Client Component** (`app/restore-button.tsx`) that consumes
  `useSorobanResurrectContext()` and runs the restore/submit flow — the only
  part that needs the wallet, so it is the only part shipped to the browser
- Wrapping the app in `SorobanResurrectProvider` from a single `'use client'`
  boundary (`app/providers.tsx`) so `app/layout.tsx` can stay a server component
- Reading configuration from environment variables, with the public RPC URL
  (`NEXT_PUBLIC_*`) kept separate from the server-only one (`SOROBAN_*`)

## How it works

`app/page.tsx` is a Server Component. It reads `?account=<public key>` from the
URL, and when present renders `ServerRestoreStatus`, which:

1. Builds the demo `withdraw` transaction with `app/lib/withdraw-tx.ts`
2. Calls `sr.needsRestore(tx)` on the server
3. When a restore is required, calls `sr.estimateRestoreCost(tx)` and renders
   the estimated fee server-side
4. Passes `needsRestore` to `<RestoreButton />`

`app/connect-wallet.tsx` connects Freighter and pushes the account into the
query string, which re-runs the Server Component for the connected account. The
imports used for detection never reach the client bundle; only the restore flow
does.

> `needsRestore()` and `estimateRestoreCost()` are read-only simulations, so
> they are safe outside the browser. Signing, submission, and wallet adapters
> remain client-side.

## Running

```bash
npm install
npm run dev
```

Optionally create a `.env.local` to point at your own endpoints:

```bash
# Server-only (never sent to the browser)
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Client (inlined into the browser bundle)
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
NEXT_PUBLIC_CONTRACT_ID=CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q
```

Because the Server Component reads `searchParams`, this route renders
dynamically — expected, since detection depends on the connected account.
