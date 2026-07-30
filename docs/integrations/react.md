# React Integration

The `@soroban-resurrect/react-hook` package is built for React 18+. Wrap the part of your app that submits transactions in a `SorobanResurrectProvider`, then read state from `useSorobanResurrectContext()` anywhere inside it.

## Setup

```bash
npm install @soroban-resurrect/sdk @soroban-resurrect/react-hook @stellar/stellar-sdk
```

```tsx
// main.tsx
import { SorobanResurrectProvider } from '@soroban-resurrect/react-hook'
import App from './App'

export function Root() {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: 'https://soroban-testnet.stellar.org' }}>
      <App />
    </SorobanResurrectProvider>
  )
}
```

## Using it in a component

```tsx
import { useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

function WithdrawButton({ tx, wallet }: { tx: Transaction; wallet: WalletAdapter }) {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()

  const handleClick = async () => {
    const result = await submitWithRestore(tx, wallet)
    if (!result.success) {
      console.error(result.error)
    }
  }

  return (
    <button onClick={handleClick} disabled={isProcessing}>
      {isProcessing ? state.message : 'Withdraw'}
    </button>
  )
}
```

## Multiple independent instances

If different parts of your app need isolated SDK instances (different RPC endpoints, or you don't want a shared provider), use the standalone hook instead:

```tsx
import { useSorobanResurrect } from '@soroban-resurrect/react-hook'

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrect({
    config: { rpcUrl: 'https://soroban-testnet.stellar.org' },
  })
  // same API as the context version
}
```

## Tips

- Keep the `config` object passed to the provider/hook referentially stable (e.g. define it outside the component or memoize it) — a new object identity is compared by value, but recreating it every render still triggers the deep-equality check on every render.
- `state.message` is a human-readable string safe to render directly in a UI.
- `state.archivedKeys` is populated once the workflow reaches `restore_needed` and later states — use it to tell the user how many entries are being restored.
