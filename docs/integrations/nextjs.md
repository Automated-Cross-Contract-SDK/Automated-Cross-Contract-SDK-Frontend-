# Next.js Integration

Soroban-Resurrect has two halves with different runtime needs:

- **Detection / estimation** — `needsRestore()` and `estimateRestoreCost()` only
  simulate transactions over RPC. They run fine on the server, so you can keep
  the RPC endpoint server-only and avoid shipping detection code to the browser.
- **Signing / submission** — `submitWithRestore()` and the wallet adapters talk
  to browser wallet extensions, so they must run in Client Components (or
  client code) as before.

The React provider and the hooks always belong on the client; only the
read-only SDK calls can move server-side.

## Setup

```bash
npm install @soroban-resurrect/sdk @soroban-resurrect/react-hook @stellar/stellar-sdk
```

```tsx
// app/providers.tsx
'use client'

import { SorobanResurrectProvider } from '@soroban-resurrect/react-hook'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL! }}>
      {children}
    </SorobanResurrectProvider>
  )
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

## Running detection in a Server Component

Because `needsRestore()` / `estimateRestoreCost()` are read-only simulations,
a Server Component can call them against a **server-only** RPC URL and pass the
result to a Client Component as props. The detection code is never included in
the client bundle.

```tsx
// app/server-status.tsx  (Server Component — no 'use client')
import { SorobanResurrect } from '@soroban-resurrect/sdk'

export async function ServerStatus({ account }: { account: string }) {
  const sr = new SorobanResurrect({
    rpcUrl: process.env.SOROBAN_RPC_URL!, // no NEXT_PUBLIC_ prefix
    networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE,
  })

  const tx = await buildWithdrawTx(sr.server, account)
  const needsRestore = await sr.needsRestore(tx)
  const estimate = needsRestore ? await sr.estimateRestoreCost(tx) : null

  return (
    <section>
      {estimate && <p>Restore fee: {estimate.estimatedFee} stroops</p>}
      <RestoreButton account={account} needsRestore={needsRestore} />
    </section>
  )
}
```

Read the account from `searchParams`, a cookie, or a Server Action so the
server knows which key to check. Everything that signs stays in the client
component below.

## Using it in a Client Component

```tsx
// app/restore-button.tsx
'use client'

import { useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

export function RestoreButton({ needsRestore }: { needsRestore: boolean }) {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()

  return (
    <button disabled={isProcessing} onClick={() => submitWithRestore(tx, wallet)}>
      {isProcessing ? state.message : needsRestore ? 'Restore & Withdraw' : 'Withdraw'}
    </button>
  )
}
```

## Notes

- Use separate env vars for the two halves: `SOROBAN_RPC_URL` for server-side
  detection (never inlined), and `NEXT_PUBLIC_SOROBAN_RPC_URL` for the client
  provider (the `NEXT_PUBLIC_` prefix is required for it to reach the browser).
- Never import `SorobanResurrectProvider`, the hooks, **or the signing /
  submission methods** (`submitWithRestore`, `sendTransaction`, `retry`,
  `restoreKeys`, wallet adapters) into a Server Component — those rely on a
  browser wallet. Detection helpers (`needsRestore`, `detectArchivedKeys`,
  `estimateRestoreCost`, `queryLedgerTTL`, `getExpiringSoonEntries`) are safe
  server-side.
- If you server-render a page that renders a client component using the hook,
  that's fine — just make sure nothing in the server-rendered tree calls
  `useSorobanResurrectContext()`.

See the runnable [`examples/nextjs-app`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/nextjs-app)
for the full server/client split.
