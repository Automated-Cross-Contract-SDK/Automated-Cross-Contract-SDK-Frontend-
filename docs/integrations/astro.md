# Astro Integration

Astro ships zero JavaScript by default, so any component that uses Soroban-Resurrect (which needs a live RPC client and a browser wallet) must be hydrated on the client with a `client:*` directive.

## Setup

```bash
npm install @soroban-resurrect/sdk @soroban-resurrect/react-hook @stellar/stellar-sdk
npx astro add react
```

## Using it in a React island

```tsx
// src/components/WithdrawWidget.tsx
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()

  return (
    <button disabled={isProcessing} onClick={() => submitWithRestore(tx, wallet)}>
      {isProcessing ? state.message : 'Withdraw'}
    </button>
  )
}

export default function WithdrawWidget() {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: import.meta.env.PUBLIC_SOROBAN_RPC_URL }}>
      <WithdrawButton />
    </SorobanResurrectProvider>
  )
}
```

```astro
---
// src/pages/index.astro
import WithdrawWidget from '../components/WithdrawWidget'
---

<html lang="en">
  <body>
    <WithdrawWidget client:only="react" />
  </body>
</html>
```

## Notes

- Use `client:only="react"` (not `client:load`) for components using `SorobanResurrectProvider` — the SDK constructs an `rpc.Server` and reads wallet globals at render time, which don't exist during Astro's server-side pass.
- Prefix env vars with `PUBLIC_` so Astro exposes them to `import.meta.env` in the browser bundle.
- Without React, you can still use `@soroban-resurrect/sdk` directly inside a `<script>` tag or a framework-agnostic island — see [Getting Started](/guide/getting-started) for the plain SDK API.
