# Getting Started

This guide walks you through installing and using the package.

## Installation

```bash
npm install @your-scope/your-package
```

## Basic usage

```ts
import { createClient } from '@your-scope/your-package';

const client = createClient({ /* options */ });
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

With persistence disabled:

- No history is written to disk, `localStorage`, or any database.
- In-memory history (if enabled) is discarded when the client is disposed or the
  process exits.
- Clearing history is a no-op beyond dropping the in-memory cache.

If you need history across restarts, keep persistence enabled and apply the
encryption requirements above.

## Integrating the SDK into an existing dApp

This tutorial adds the SDK to an application that already works, without
rewriting it. It covers the wallet signing flow, failure UX, and a repeatable
verification flow so you can confirm the integration works.

### Step 1 — Install and configure the client

Add the package to your existing project and create a single client instance at
startup. Keep the configuration in one module so every call site shares it:

```ts
// src/sdk.ts
import { createClient } from '@your-scope/your-package';

export const client = createClient({
  network: 'testnet',
  // Persist history only if your storage layer meets the encryption
  // requirements above; otherwise keep it in memory.
  persistHistory: false,
});
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

Your dApp already has a connected wallet. Pass the wallet's signing function to
the SDK instead of handling keys yourself — the SDK builds the transaction and
the wallet prompts the user to sign:

```ts
import { client } from './sdk';

async function submitPayment(destination: string, amount: string) {
  const result = await client.submit({
    operation: { type: 'payment', destination, amount },
    // The wallet owns the secret key and shows its own approval prompt.
    sign: (envelope) => wallet.signTransaction(envelope),
  });
  return result;
}
```

Never read or store the user's secret key in your application; the wallet is the
only component that signs.

### Step 3 — Handle failures with clear UX

Submissions can fail at several points: the user rejects the signature request,
the network rejects the transaction, or the request times out. Surface each case
distinctly instead of a generic error:

```ts
import { client } from './sdk';

try {
  const result = await submitPayment(destination, amount);
  showSuccess(result.hash);
} catch (err) {
  if (err.code === 'USER_REJECTED') {
    // The user declined the wallet prompt — not an error to alarm them about.
    showNotice('Signature cancelled. Nothing was submitted.');
  } else if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT') {
    // Safe to retry; the transaction may not have been submitted.
    showRetry('Could not reach the network. Please try again.');
  } else {
    // The network rejected the transaction (e.g. insufficient balance).
    showError(err.message);
  }
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

- Treat a user-rejected signature as a normal outcome, not an error.
- Offer a retry for transient network failures and timeouts.
- Show the network's rejection reason for validation failures.
- Never display raw error objects or secret material to the user.

### Step 4 — Verify the integration

Run this repeatable check after wiring the SDK in. It exercises the happy path
and the failure path so you can confirm both work:

1. **Happy path** — submit a small payment on testnet. Confirm the wallet prompt
   appears, approve it, and verify the returned hash appears in your history and
   on a block explorer.
2. **User rejection** — submit again and decline the wallet prompt. Confirm your
   UI shows the cancellation notice and no transaction is submitted.
3. **Network failure** — disable the network (or point at an unreachable
   endpoint) and submit. Confirm the retry UI appears.
4. **History** — confirm the successful transaction is recorded and that
   clearing history removes it from both memory and any persisted store.

Repeat these steps on every change to the integration; they cover the expected
path and the relevant failure cases.

## Next steps

`AbortSignalOptions` is exported as a stable type. A `{ signal }` options object
is accepted by `simulate`, `detectArchivedKeys`, `detectArchivedKeysBatch`,
`needsRestore`, `estimateRestoreCost`, `buildRestoreTx` (after its o
