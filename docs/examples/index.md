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

## Svelte Example App

A Svelte example lives at [`examples/svelte`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/svelte). It demonstrates the Svelte store lifecycle, wallet signing prompts, explicit user consent before a restore, and safe cleanup after navigation.

```bash
cd examples/svelte
npm install
npm run dev
```

The example exposes a small, stable interface so the flow can be reused and tested:

```typescript
// examples/svelte/src/lib/restoreStore.ts
export interface RestoreStoreOptions {
  rpcUrl: string
  wallet: WalletAdapter
}

export interface RestoreStoreState {
  state: RestoreState
  message: string
  archivedKeys: ArchivedLedgerEntry[]
  consentRequired: boolean
  result?: SubmitWithRestoreResult
  error?: Error
}

// createRestoreStore returns a Svelte readable store plus actions.
export function createRestoreStore(options: RestoreStoreOptions): {
  subscribe: Readable<RestoreStoreState>['subscribe']
  submit: (tx: Transaction) => Promise<void>
  grantConsent: () => void
  denyConsent: () => void
  destroy: () => void
}
```

### Store lifecycle and cleanup

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { createRestoreStore } from './lib/restoreStore'

  export let rpcUrl: string
  export let wallet: WalletAdapter

  const store = createRestoreStore({ rpcUrl, wallet })

  // Safe cleanup after navigation: unsubscribe and abort in-flight work.
  onDestroy(() => store.destroy())
</script>
```

### Consent before restore

```svelte
{#if $store.consentRequired}
  <div class="consent">
    <p>{$store.archivedKeys.length} archived entries must be restored before submitting.</p>
    <button on:click={store.grantConsent}>Restore and continue</button>
    <button on:click={store.denyConsent}>Cancel</button>
  </div>
{:else}
  <p>{$store.message}</p>
{/if}
```

### Wallet signing prompts

```typescript
// The store surfaces each signing prompt through onStateChange so the UI can
// show the wallet prompt before the adapter is invoked.
sr.onStateChange((info) => {
  if (info.state === 'signing_restore' || info.state === 'signing_original') {
    promptWallet(info.message)
  }
})
```

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
