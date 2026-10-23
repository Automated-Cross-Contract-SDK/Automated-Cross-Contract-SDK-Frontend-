# Examples

## Runnable Example App

The repository ships a full runnable example at [`examples/basic`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/basic) — a Vite + React app wired up to the SDK end-to-end.

```bash
git clone https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-.git
cd Automated-Cross-Contract-SDK-Frontend-
npm install
npm run dev:example
```

This starts a local dev server demonstrating connecting a wallet, building a transaction, and calling `submitWithRestore`.

## Production-Style React Application

[`examples/react-app`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/react-app) is a realistic React + TypeScript application that goes beyond the minimal example. It demonstrates the patterns you need to ship the SDK in production:

- **Routing** — `react-router-dom` with a wallet-gated route tree (`/`, `/wallet`, `/submit`, `/history`).
- **Wallet lifecycle** — connect, disconnect, account/network change handling, and reconnection on reload via a `WalletProvider`.
- **User feedback** — a state-machine-driven progress indicator plus toast notifications for success and failure.
- **Fee consent** — an explicit confirmation dialog before any restore fee is signed, with the estimated fee surfaced to the user.
- **Cancellation** — an `AbortController`-based cancel path that stops in-flight restore/submit work and returns the UI to a clean state.
- **Typed error handling** — a discriminated `Result` type and exhaustive error rendering for every SDK failure mode.

```bash
git clone https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-.git
cd Automated-Cross-Contract-SDK-Frontend-/examples/react-app
npm install
npm run dev
```

### Stable interface

The example exposes a small, documented surface so you can copy it into your own app:

```typescript
// src/sdk/useResurrect.ts
export interface UseResurrectOptions {
  rpcUrl: string
  wallet: WalletAdapter | null
}

export interface UseResurrectResult {
  state: ResurrectState
  submit: (tx: Transaction) => Promise<SubmitResult>
  cancel: () => void
  reset: () => void
}

export function useResurrect(options: UseResurrectOptions): UseResurrectResult
```

`submit` resolves to a typed `SubmitResult` (`{ success: true; originalTxHash: string } | { success: false; error: ResurrectError }`), and `cancel` aborts any in-flight work. The hook is covered by automated tests for the happy path, fee-consent rejection, cancellation, and each typed error branch.

### Compatibility notes

- Requires React 18+ and `react-router-dom` 6+.
- Targets the same SDK version as the rest of the docs; if you upgrade the SDK, update the dependency in `examples/react-app/package.json` to match.
- The wallet adapter is pluggable — the example ships with a Freighter adapter, but any adapter implementing `WalletAdapter` works.

## Vue Application

[`examples/vue-app`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/vue-app) is a Vue 3 + TypeScript application that wires the Vue composable to a wallet connection flow. It demonstrates the full restore lifecycle with explicit UI states:

- **Loading** — a spinner and status label while the wallet connects and while restore/submit work is in flight.
- **Rejection** — a clear message when the user rejects the wallet signature request, with a retry action.
- **Restore success** — the restored transaction hash is surfaced once the original transaction is submitted.
- **Failure** — typed SDK errors are rendered exhaustively, with a reset action to return to a clean state.

```bash
git clone https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-.git
cd Automated-Cross-Contract-SDK-Frontend-/examples/vue-app
npm install
npm run dev
```

### Stable interface

The example exposes a small, documented composable so you can copy it into your own app:

```typescript
// src/composables/useResurrect.ts
export interface UseResurrectOptions {
  rpcUrl: string
  wallet: Ref<WalletAdapter | null>
}

export interface UseResurrectResult {
  state: Ref<ResurrectState>
  loading: Ref<boolean>
  error: Ref<ResurrectError | null>
  submit: (tx: Transaction) => Promise<SubmitResult>
  cancel: () => void
  reset: () => void
}

export function useResurrect(options: UseResurrectOptions): UseResurrectResult
```

`submit` resolves to a typed `SubmitResult` (`{ success: true; originalTxHash: string } | { success: false; error: ResurrectError }`), and `cancel` aborts any in-flight work. The composable is covered by automated tests for the happy path, wallet rejection, restore success, and each typed error branch.

### Compatibility notes

- Requires Vue 3.3+ and `vue-tsc` for type checking.
- Targets the same SDK version as the rest of the docs; if you upgrade the SDK, update the dependency in `examples/vue-app/package.json` to match.
- The wallet adapter is pluggable — the example ships with a Freighter adapter, but any adapter implementing `WalletAdapter` works.

## Minimal Plain JavaScript Example

If you are not using a framework, [`examples/plain-js`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/plain-js) is a dependency-light browser example: a single `index.html` plus `main.js` that loads the SDK from a CDN, connects a wallet, builds a transaction, and demonstrates both the restore and no-restore paths.

```html
<!-- index.html -->
<button id="connect">Connect wallet</button>
<button id="submit">Submit transaction</button>
<pre id="log"></pre>
<script type="module" src="./main.js"></script>
```

```javascript
// main.js — no framework, no build step
import { SorobanResurrect } from 'https://esm.sh/@soroban-resurrect/sdk'

const log = (msg) => (document.getElementById('log').textContent += msg + '\n')

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

sr.onStateChange((info) => log(`[${info.state}] ${info.message}`))

let wallet = null

document.getElementById('connect').addEventListener('click', async () => {
  wallet = await connectWallet() // your wallet adapter, e.g. Freighter
  log(`Connected: ${wallet.publicKey}`)
})

document.getElementById('submit').addEventListener('click', async () => {
  if (!wallet) return log('Connect a wallet first')

  const tx = await buildTransaction(wallet.publicKey) // your contract call

  // No-restore path: submit directly when nothing is archived.
  if (!(await sr.needsRestore(tx))) {
    const result = await sr.submitWithRestore({ transaction: tx, wallet })
    return log(result.success ? `Submitted ${result.originalTxHash}` : `Failed: ${result.error}`)
  }

  // Restore path: archived entries are restored, then the original is submitted.
  const result = await sr.submitWithRestore({
    transaction: tx,
    wallet,
    onRestoreNeeded: (keys) => log(`Restoring ${keys.length} archived entries…`),
    onRestoreFailed: (error) => log(`Restore failed: ${error.message}`),
  })

  log(result.success ? `Submitted ${result.originalTxHash}` : `Failed: ${result.error}`)
})
```

Serve the folder with any static file server (for example `npx serve examples/plain-js`) and open it in a browser. The example targets the same SDK version as the rest of the docs; if you upgrade the SDK, update the CDN URL in `main.js` to match.

## Interactive Playground

Want to try the flow without installing anything? The
[Interactive Playground](/examples/playground) runs the SDK's state machine in
your browser against a fake RPC client with canned responses — no wallet, no
network. Edit the snippet, pick a scenario, and watch the state transitions,
RPC calls, and result.

## Interactive Snippets

### Minimal restore check

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

const needsRestore = await sr.needsRestore(tx)
console.log(needsRestore ? 'Restore required' : 'Ready to submit')
```

### Progress bar driven by `onStateChange`

```typescript
const STEPS: Record<string, number> = {
  idle: 0,
  simulating: 10,
  restore_needed: 20,
  signing_restore: 35,
  submitting_restore: 50,
  confirming_restore: 65,
  signing_original: 80,
  submitting_original: 90,
  success: 100,
  error: 100,
}

sr.onStateChange((info) => {
  progressBar.value = STEPS[info.state] ?? 0
  statusLabel.textContent = info.message
})
```

### Rendering archived keys detected during a restore

```tsx
function ArchivedKeysBanner({ archivedKeys }: { archivedKeys: ArchivedLedgerEntry[] }) {
  if (archivedKeys.length === 0) return null

  return (
    <div className="banner">
      {archivedKeys.length} ledger {archivedKeys.length === 1 ? 'entry needs' : 'entries need'} to
      be restored before this transaction can be submitted.
    </div>
  )
}
```

### Estimating restore fees and asking for consent

Restore fees are separate from the original transaction cost. Estimate both,
show them side by side, and only proceed once the user explicitly consents to
the extra restore fee. See [Restore fees](/guide/restore-fees) for the full
fee model and consent patterns.

```typescript
const estimate = await sr.estimateRestoreFees(tx)
// estimate.originalFee  — cost of the original transaction
// estimate.restoreFee   — extra cost to restore archived entries
// estimate.totalFee     — originalFee + restoreFee

const consent = await requestConsent({
  title: 'Restore required',
  body:
    `This transaction needs ${estimate.archivedKeys.length} archived ` +
    `entries restored.\n\n` +
    `Original transaction fee: ${formatStroops(estimate.originalFee)}\n` +
    `Restore fee: ${formatStroops(estimate.restoreFee)}\n` +
    `Total: ${formatStroops(estimate.totalFee)}`,
  confirmLabel: 'Pay restore fee and continue',
  cancelLabel: 'Cancel',
})

if (!consent) return // user declined — do not submit

const result = await sr.submitWithRestore({ transaction: tx, wallet })
```

### Full submit flow with error handling

```typescript
async function withdraw(tx: Transaction, wallet: WalletAdapter) {
  const result = await sr.submitWithRestore({
    transaction: tx,
    wallet,
    onRestoreNeeded: (keys) => setBanner(`Restoring ${keys.length} archived entries…`),
    onRestoreFailed: (error) => setError(error),
  })

  if (!result.success) {
    setError(result.error ?? 'Unknown error')
    return
  }

  setSuccess(result.originalTxHash!)
}
```

More end-to-end walkthroughs live in the [Tutorial](/guide/tutorial).
