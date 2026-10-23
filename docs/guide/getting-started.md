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

## Local Soroban RPC environment

For offline development and reproducible tests, run a local Soroban RPC node
instead of pointing at a public endpoint. The steps below produce a
reproducible environment that the SDK and examples can target.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+ (or a native `stellar` CLI install)
- The [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) (`stellar`)
- Node.js 20+ (matches the SDK requirement above)

### Start the local network

```bash
# Start a local Stellar network (core + Soroban RPC) in the background.
stellar network start local

# The RPC endpoint is now available at:
#   http://localhost:8000/soroban/rpc
# The network passphrase for the local network is:
#   Standalone Network ; February 2017
```

To stop the network when you're done:

```bash
stellar network stop local
```

### Configure the SDK

Point the SDK at the local endpoint. The local network uses its own
passphrase, so pass it explicitly rather than relying on a preset:

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({
  rpcUrl: 'http://localhost:8000/soroban/rpc',
  networkPassphrase: 'Standalone Network ; February 2017',
})
```

You can also set these via environment variables for the examples:

```bash
export SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
export SOROBAN_NETWORK_PASSPHRASE="Standalone Network ; February 2017"
```

### Verify endpoint readiness

Before running examples, confirm the endpoint is reachable and healthy. The
`@soroban-resurrect/sdk` package ships a helper with a stable interface:

```typescript
import { checkSorobanRpcReadiness } from '@soroban-resurrect/sdk'

const status = await checkSorobanRpcReadiness({
  rpcUrl: 'http://localhost:8000/soroban/rpc',
  timeoutMs: 5000,
})

if (!status.ready) {
  console.error('Soroban RPC not ready:', status.reason)
  process.exit(1)
}

console.log('Soroban RPC ready:', status.latestLedger)
```

`checkSorobanRpcReadiness` resolves to a `SorobanRpcReadiness` object:

| Field          | Type      | Description                                              |
| -------------- | --------- | -------------------------------------------------------- |
| `ready`        | `boolean` | `true` when the endpoint responded with a valid ledger.  |
| `latestLedger` | `number?` | Latest ledger sequence reported by the endpoint.         |
| `reason`       | `string?` | Human-readable failure reason when `ready` is `false`.    |

It returns `ready: false` (rather than throwing) for unreachable endpoints,
timeouts, and malformed responses, so it is safe to call in CI and scripts.

### Compatibility notes

- The helper targets the same Soroban RPC version as `@stellar/stellar-sdk`
  `^12.0.0`; older RPC nodes that do not implement `getLatestLedger` will
  report `ready: false` with a `reason` describing the unsupported method.
- Public endpoints (Testnet/Futurenet/Mainnet) work with the same helper —
  swap `rpcUrl` and `networkPassphrase` accordingly.

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

## Quick Start (Plain JavaScript)

No framework required — this example runs directly in the browser. It connects
a wallet, builds a transaction, and demonstrates both the restore and
no-restore paths. See [`examples/plain-js`](https://github.com/soroban-resurrect/soroban-resurrect/tree/main/examples/plain-js)
for the full runnable project.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Soroban-Resurrect — Plain JS</title>
  </head>
  <body>
    <button id="connect">Connect wallet</button>
    <button id="submit" disabled>Submit withdraw</button>
    <pre id="log"></pre>

    <script type="module">
      import { SorobanResurrect } from '@soroban-resurrect/sdk'
      import {
        TransactionBuilder,
        Account,
        Operation,
        Networks,
        nativeToScVal,
      } from '@stellar/stellar-sdk'

      const log = (msg) => {
        document.getElementById('log').textContent += msg + '\n'
      }

      const sr = new SorobanResurrect({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: Networks.TESTNET,
      })

      let publicKey = null

      // WalletAdapter shape — swap in xBull or a custom signer as needed.
      const wallet = {
        isConnected: async () => publicKey !== null,
        getPublicKey: async () => publicKey,
        signTransaction: async (txXdr, opts) =>
          window.freighter.signTransaction(txXdr, opts),
      }

      document.getElementById('connect').addEventListener('click', async () => {
        const { publicKey: pk } = await window.freighter.requestAccess()
        publicKey = pk
        log('Connected: ' + publicKey)
        document.getElementById('submit').disabled = false
      })

      document.getElementById('submit').addEventListener('click', async () => {
        const account = await sr.rpc.getAccount(publicKey)
        const tx = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.invokeContractFunction({
              contract: 'CCJZ5...K2Q',
              function: 'withdraw',
              args: [nativeToScVal(1000, { type: 'i128' })],
            }),
          )
          .setTimeout(30)
          .build()

        // No-restore path: nothing archived, submit directly.
        const needsRestore = await sr.needsRestore(tx)
        if (!needsRestore) {
          log('No archived entries — submitting directly.')
        } else {
          log('Archived entries detected — restore will run first.')
        }

        // Restore path: submitWithRestore handles both cases automatically.
        const result = await sr.submitWithRestore({ transaction: tx, wallet })
        if (result.success) {
          log('Original tx hash: ' + result.originalTxHash)
          if (result.restoreTxHash) {
            log('Restore tx hash: ' + result.restoreTxHash)
            log('Archived keys restored: ' + result.archivedKeysDetected)
          }
        } else {
          log('Failed: ' + result.error)
        }
      })
    </script>
  </body>
</html>
```

`needsRestore` and `submitWithRestore` are the stable entry points used here;
both accept the same `WalletAdapter` shape shown above. When `needsRestore`
returns `false` the SDK submits the original transaction unchanged, so the
no-restore path is a strict subset of the restore path.

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

## Production-style React application

For a realistic, production-shaped React app — routing, wallet lifecycle,
user feedback, fee consent, cancellation, and typed error handling — see
[`examples/react-app`](https://github.com/soroban-resurrect/soroban-resurrect/tree/main/examples/react-app).
The example is a small Vite + React + TypeScript project that wires the
`@soroban-resurrect/react-hook` provider into a multi-route app and shows how
the stable SDK surface is used end to end.

What the example demonstrates:

- **Routing** — `react-router-dom` routes for a dashboard, a withdraw flow, and
  a transaction history view, all sharing one provider instance.
- **Wallet lifecycle** — connect, disconnect, and reconnect flows with a
  `WalletAdapter` implementation, including handling of a wallet that becomes
  unavailable mid-session.
- **User feedback** — a status banner driven by the hook's `state`
  (`idle` → `simulating` → `awaiting-consent` → `signing` → `submitting` →
  `confirming` → `success` / `error` / `cancelled`).
- **Fee consent** — before a restore is submitted, the app surfaces the
  estimated restore cost from `estimateRestoreCost` and requires explicit user
  confirmation.
- **Cancellation** — an `AbortController` is created per submission and aborted
  when the user cancels or navigates away, so `submitWithRestore` resolves with
  `errorCode === 'ABORTED'`.
- **Typed error handling** — a `switch` on `result.errorCode` (e.g. `ABORTED`,
  `WALLET_REJECTED`, `SIMULATION_FAILED`, `RESTORE_FAILED`) with user-facing
  copy for each case.

Run it locally:

```bash
cd examples/react-app
npm install
npm run dev
```

Run its tests:

```bash
cd examples/react-app
npm test
```

The example's tests cover the happy path (no restore needed), the restore path
with fee consent, user cancellation, and wallet-rejection error handling. The
interfaces it relies on — `SorobanResurrectProvider`, `useSorobanResurrectContext`,
`submitWithRestore`, `estimateRestoreCost`, `needsRestore`, and the
`AbortSignalOptions` type — are the same stable entry points documented above,
so the example remains compatible across supported package releases.

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
`needsRestore`, `estimateRestoreCost`, `buildRestoreTx` (after its o