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
