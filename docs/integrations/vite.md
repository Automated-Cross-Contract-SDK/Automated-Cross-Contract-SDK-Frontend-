# Vite Integration

The repository's own [`examples/basic`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/basic) app is a Vite + React project wired up to the SDK — use it as a reference implementation.

## Setup

```bash
npm create vite@latest my-dapp -- --template react-ts
cd my-dapp
npm install @soroban-resurrect/sdk @soroban-resurrect/react-hook @stellar/stellar-sdk
```

```tsx
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SorobanResurrectProvider } from '@soroban-resurrect/react-hook'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SorobanResurrectProvider config={{ rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL }}>
      <App />
    </SorobanResurrectProvider>
  </StrictMode>,
)
```

```env
# .env
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

## Using it in a component

```tsx
// src/App.tsx
import { useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

function App() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()

  return (
    <button disabled={isProcessing} onClick={() => submitWithRestore(tx, wallet)}>
      {isProcessing ? state.message : 'Withdraw'}
    </button>
  )
}

export default App
```

## Notes

- Vite exposes env vars prefixed with `VITE_` on `import.meta.env` — use that prefix for anything read client-side, like the RPC URL.
- Not using React? The core `@soroban-resurrect/sdk` package has no framework dependency — use `SorobanResurrect` directly in a plain TypeScript/Vite project (see [Getting Started](/guide/getting-started)).
