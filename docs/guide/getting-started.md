# Getting Started

Soroban-Resurrect solves the "archived ledger entry" problem for Soroban dApps. When a user's persistent data (token balance, loan position, etc.) expires due to TTL rent, their transaction fails with a cryptic error. This SDK automatically detects archived entries via [CAP-0066](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0066.md) and seamlessly restores them before submitting the user's intended transaction.

## Installation

```bash
npm install @soroban-resurrect/sdk @stellar/stellar-sdk
```

If you're building a React dApp, also install the hook package:

```bash
npm install @soroban-resurrect/react-hook
```

`@stellar/stellar-sdk` (`^12.0.0`) and `react` (`^18.0.0`, for the hook package) are peer dependencies — install them alongside the SDK.

## Requirements

- Node.js 20+
- Current and previous major releases of Chrome, Edge, Firefox, and Safari.
  The browser SDK build targets ES2022 and requires `fetch`, `AbortController`,
  `TextEncoder`, and `TextDecoder`; SSE additionally requires a streaming
  `Response.body`. When SSE streaming is unavailable, transaction confirmation
  falls back to RPC polling.
- A Soroban RPC endpoint (Testnet, Futurenet, or Mainnet)
- A wallet that can sign Soroban transaction XDR (Freighter, xBull, or a custom signer)

## Quick Start (Direct SDK)

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { TransactionBuilder, Account, Operation, Networks } from '@stellar/stellar-sdk'

const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
})

// Build the transaction you actually want to submit
const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
  .addOperation(
    Operation.invokeContractFunction({
      contract: 'CCJZ5...K2Q',
      function: 'withdraw',
      args: [nativeToScVal(1000, { type: 'i128' })],
    }),
  )
  .setTimeout(30)
  .build()

// Check up front whether restoration will be needed
const needsRestore = await sr.needsRestore(tx)

// Wrap your wallet in the WalletAdapter shape
const wallet = {
  isConnected: async () => true,
  getPublicKey: async () => freighter.publicKey,
  signTransaction: async (txXdr, opts) => freighter.signTransaction(txXdr, opts),
}

// Submit — restoration (if needed) happens automatically
const result = await sr.submitWithRestore({ transaction: tx, wallet })

if (result.success) {
  console.log('Original tx hash:', result.originalTxHash)
  if (result.restoreTxHash) {
    console.log('Restore tx hash:', result.restoreTxHash)
    console.log('Archived keys restored:', result.archivedKeysDetected)
  }
} else {
  console.error('Failed:', result.error)
}
```

## Quick Start (React)

```tsx
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

function App() {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: 'https://soroban-testnet.stellar.org' }}>
      <WithdrawButton />
    </SorobanResurrectProvider>
  )
}

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()

  const handleWithdraw = async () => {
    const result = await submitWithRestore(tx, wallet)
    // result.success, result.originalTxHash, etc.
  }

  return (
    <button onClick={handleWithdraw} disabled={isProcessing}>
      {isProcessing ? state.message : 'Withdraw'}
    </button>
  )
}
```

## Choosing an approach

If you already use Soroban RPC and only need a single, application-specific
restore flow, you may prefer to maintain that small flow yourself. See
[Manual restore flow vs. the SDK](/guide/comparison) for the trade-offs,
dependencies, and bundle-size measurement command.

## Cancelling a restore workflow

Pass an `AbortSignal` to cancel further SDK work, including simulation waits,
wallet prompts that honor the signal, and transaction-confirmation polling:

```typescript
const controller = new AbortController()
const result = await sr.submitWithRestore({
  transaction: tx,
  wallet,
  signal: controller.signal,
})

// Call from a cancel button or when the owning view is disposed:
controller.abort()

if (!result.success && result.errorCode === 'ABORTED') {
  // A transaction already submitted may still complete on-chain.
}
```

`AbortSignalOptions` is exported as a stable type. A `{ signal }` options object
is accepted by `simulate`, `detectArchivedKeys`, `detectArchivedKeysBatch`,
`needsRestore`, `estimateRestoreCost`, `buildRestoreTx` (after its optional
simulation response), `buildBatchRestoreTx`, `sendTransaction`, `retry`, and
`restoreKeys`. `submitWithRestore` accepts `signal` in its options object, and
`submitBatchWithRestore(items, { signal })` uses one signal for the whole batch.
Existing calls that omit a signal are unchanged.

Cancellation stops the SDK from starting later steps and clears polling timers
and temporary abort listeners. Wallet adapters may ignore the signal, and the
Stellar SDK's RPC methods do not expose request cancellation; an in-flight RPC
or wallet prompt may therefore finish in the background. Aborting cannot undo a
submitted transaction, so inspect its returned hash/status before retrying.

## Next Steps

- Walk through common patterns in the [Tutorial](/guide/tutorial)
- Browse the full [API Reference](/api/sdk)
- See [runnable Examples](/examples/)
- Wire the SDK into your framework via the [Integration Guides](/integrations/react)
