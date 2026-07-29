# Next.js Integration

Soroban-Resurrect talks to the Soroban RPC endpoint and to browser wallet extensions, both of which only exist client-side. In the Next.js App Router, mark the provider (and any component that calls SDK methods) as a Client Component.

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
    <SorobanResurrectProvider
      config={{ rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL! }}
    >
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

## Using it in a Client Component

```tsx
// app/withdraw-button.tsx
'use client'

import { useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

export function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()

  return (
    <button disabled={isProcessing} onClick={() => submitWithRestore(tx, wallet)}>
      {isProcessing ? state.message : 'Withdraw'}
    </button>
  )
}
```

## Notes

- Set `NEXT_PUBLIC_SOROBAN_RPC_URL` in your `.env.local` — the `NEXT_PUBLIC_` prefix is required for it to reach the client bundle.
- Never import `SorobanResurrectProvider` or call SDK methods from a Server Component or Route Handler — the underlying `rpc.Server` client and wallet adapters assume a browser environment.
- If you server-render a page that eventually renders a client component using the hook, that's fine — just make sure nothing in the server-rendered tree tries to read `useSorobanResurrectContext()` before hydration.
