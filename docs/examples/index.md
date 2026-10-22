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

## Step-by-Step Integration Tutorial

This walkthrough adds the SDK to an **existing** dApp — no rewrite required.
It covers failure UX, wallet signing, and a repeatable verification flow.

### 1. Install and configure

```bash
npm install @soroban-resurrect/sdk
```

Create a single shared client next to your existing RPC setup:

```typescript
// src/lib/resurrect.ts
import { SorobanResurrect } from '@soroban-resurrect/sdk'

export const sr = new SorobanResurrect({
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL,
  networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE,
})
```

### 2. Route your existing submit through the SDK

Find the call site that currently submits a transaction and wrap it. The SDK
only intervenes when a restore is required; otherwise it submits as before.

```typescript
import { sr } from './lib/resurrect'

async function submit(tx: Transaction, wallet: WalletAdapter) {
  return sr.submitWithRestore({ transaction: tx, wallet })
}
```

### 3. Wire wallet signing

The SDK asks your `WalletAdapter` to sign twice in the worst case: once for the
restore transaction and once for the original. Your adapter must implement
`signTransaction(xdr, opts)` and return the signed XDR — the same method your
existing wallet integration already uses.

```typescript
const wallet: WalletAdapter = {
  publicKey: await kit.getPublicKey(),
  signTransaction: async (xdr, opts) => {
    const { signedTxXdr } = await kit.signTransaction(xdr, opts)
    return signedTxXdr
  },
}
```

If the user rejects either signature, the SDK surfaces a `WalletRejectedError`
and stops — the original transaction is never submitted.

### 4. Design the failure UX

Handle the three failure classes explicitly so users always know what happened:

```typescript
const result = await sr.submitWithRestore({
  transaction: tx,
  wallet,
  onRestoreNeeded: (keys) => setStatus(`Restoring ${keys.length} archived entries…`),
  onRestoreFailed: (error) => setStatus(`Restore failed: ${error.message}`),
})

if (!result.success) {
  switch (result.error?.code) {
    case 'WALLET_REJECTED':
      setStatus('Signature cancelled — nothing was submitted.')
      break
    case 'RESTORE_FAILED':
      setStatus('Could not restore archived state. Try again later.')
      break
    default:
      setStatus(`Submission failed: ${result.error?.message ?? 'Unknown error'}`)
  }
  return
}

setStatus(`Submitted: ${result.originalTxHash}`)
```

Always render a terminal state (success or error) — never leave the progress
indicator spinning after `submitWithRestore` resolves.

### 5. Verify the integration

Run this checklist against testnet before shipping:

1. **Happy path** — submit a transaction whose entries are live. Confirm it
   succeeds without any restore prompt.
2. **Restore path** — submit a transaction touching an archived entry. Confirm
   the restore prompt appears, both signatures are requested, and the original
   transaction hash is returned.
3. **Rejection path** — cancel the wallet prompt. Confirm the UI shows the
   cancelled state and no transaction is submitted.
4. **Failure path** — point `rpcUrl` at an unreachable endpoint. Confirm the UI
   shows the failure state and the progress indicator stops.

You can also replay these scenarios offline in the
[Interactive Playground](/examples/playground) before touching a real network.

More end-to-end walkthroughs live in the [Tutorial](/guide/tutorial).
