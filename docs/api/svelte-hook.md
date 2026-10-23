# Svelte Hook (`@soroban-resurrect/svelte-hook`)

`createSorobanResurrect(configStore)` wraps a `SorobanResurrect` SDK instance in
Svelte stores. Pass a readable store of `SorobanResurrectConfig`; the SDK is
recreated whenever the config changes.

```svelte
<script>
  import { onDestroy } from 'svelte'
  import { writable } from 'svelte/store'
  import { createSorobanResurrect } from '@soroban-resurrect/svelte-hook'

  const config = writable({ rpcUrl: 'https://soroban-testnet.stellar.org' })
  const {
    state,
    isProcessing,
    archivedKeys,
    feeEstimate,
    lastResult,
    submitWithRestore,
    submitBatch,
    estimate,
    reset,
    cancel,
    destroy,
  } = createSorobanResurrect(config)

  onDestroy(destroy)
</script>
```

`cancel()` aborts active local submissions while leaving the store usable.
`destroy()` is idempotent: it aborts active submissions, unsubscribes from the
config and SDK event/state streams, and calls `resurrect.dispose()` to stop
SDK-owned TTL watches. After destruction, methods that need the SDK throw
`SorobanResurrect store has been destroyed.` Svelte's normal component teardown
continues to release subscribers to the readable stores.

## Returned stores

| Store          | Type                                | Notes                                                                                |
| -------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `state`        | `Readable<RestoreStateInfo>`        | Current workflow state.                                                              |
| `isProcessing` | `Readable<boolean>`                 | `true` while a restore/submit is in flight.                                          |
| `archivedKeys` | `Readable<ArchivedLedgerEntry[]>`   | Populated only once the SDK reaches `restore_needed` (or later); `[]` otherwise.     |
| `feeEstimate`  | `Readable<FeeEstimate \| null>`     | Last result of `estimate()`; `null` until called (and after `reset()` back to idle). |
| `lastResult`   | `Readable<ResurrectResult \| null>` | Most recent result from `submitWithRestore` / `submitBatch`.                         |

The store shape is backward compatible — existing consumers of `state`,
`isProcessing`, `submitWithRestore`, `detectArchivedKeys`, `reset`, `resurrect`
and `destroy` are unaffected.

## Methods

### `reset(fromState?)`

Resets SDK state back to `idle`. Optionally only resets when currently in
`fromState`. Clears `feeEstimate` once state returns to idle.

### `submitBatch(items)`

Wraps `submitBatchWithRestore`. Submits each `SubmitWithRestoreOptions` entry
sequentially and returns:

```ts
interface BatchSubmission {
  items: Readable<BatchItemState>[] // one store per input item, in order
  done: Promise<ResurrectResult[]> // resolves with every per-item result
}
```

Each `BatchItemState` is `{ status: 'pending' | 'submitting' | 'success' | 'error', result }`,
so a UI can render per-item progress reactively:

```svelte
<script>
  const { items, done } = submitBatch([
    { transaction: tx1, wallet },
    { transaction: tx2, wallet },
  ])
  const results = await done
</script>

{#each items as item}
  <li>{$item.status}</li>
{/each}
```

A resolved failed result (including a wallet cancellation) sets that item's
status to `error`, preserves the result on the item and in `lastResult`, and
does not reject `done`. `destroy()` removes both the config and SDK-state
subscriptions; call it from Svelte's `onDestroy()`.

### `estimate(transaction)`

Simulates the transaction, detects archived keys, and returns a `FeeEstimate`
(`{ archivedKeysDetected, minResourceFee, estimatedRestoreFee, multiplier }`)
while also pushing it into the `feeEstimate` store.

## Example application: restore recovery UX

The `examples/svelte-restore-recovery` sample app demonstrates the full store
lifecycle with a restore-recovery flow. It is a reference for the patterns
below; copy the relevant pieces into your own app rather than depending on the
example package.

### Lifecycle

1. Create the store once at component setup with a `writable` config.
2. Subscribe to `state` / `isProcessing` / `archivedKeys` in the template.
3. Call `destroy()` from `onDestroy()` so SDK TTL watches and subscriptions are
   released when the user navigates away.

### Wallet signing prompts and user consent

The example never restores or submits without explicit consent. When the SDK
reaches `restore_needed`, the UI shows the archived keys and the
`feeEstimate` (via `estimate()`), then requires the user to confirm before
calling `submitWithRestore`. The wallet's own signing prompt is the final
consent gate; a wallet cancellation resolves as a failed `ResurrectResult`
(not a thrown error) and the UI returns to an idle, retryable state.

```svelte
<script>
  import { onDestroy } from 'svelte'
  import { writable } from 'svelte/store'
  import { createSorobanResurrect } from '@soroban-resurrect/svelte-hook'

  export let transaction
  export let wallet

  const config = writable({ rpcUrl: 'https://soroban-testnet.stellar.org' })
  const {
    state,
    isProcessing,
    archivedKeys,
    feeEstimate,
    lastResult,
    estimate,
    submitWithRestore,
    reset,
    destroy,
  } = createSorobanResurrect(config)

  let consented = false

  async function onEstimate() {
    consented = false
    await estimate(transaction)
  }

  async function onConfirmRestore() {
    consented = true
    await submitWithRestore({ transaction, wallet })
  }

  onDestroy(destroy)
</script>

{#if $state.name === 'restore_needed'}
  <p>This transaction touches {$archivedKeys.length} archived ledger entries.</p>
  {#if $feeEstimate}
    <p>Estimated restore fee: {$feeEstimate.estimatedRestoreFee}</p>
  {/if}
  <button on:click={onConfirmRestore} disabled={$isProcessing || !consented}>
    Restore and submit
  </button>
{/if}

{#if $lastResult && !$lastResult.success}
  <p>Submission failed: {$lastResult.error}</p>
  <button on:click={() => reset('restore_needed')}>Retry</button>
{/if}
```

### Safe cleanup after navigation

Because `destroy()` is idempotent and aborts in-flight submissions, it is safe
to call from `onDestroy()` even if the user navigates away mid-restore. After
destruction the store's SDK-backed methods throw
`SorobanResurrect store has been destroyed.`; the example guards against this by
only invoking them from user actions on a mounted component.

### Compatibility and migration notes

- The example targets the current store shape; no migration is required for
  existing consumers of `state`, `isProcessing`, `submitWithRestore`,
  `detectArchivedKeys`, `reset`, `resurrect`, and `destroy`.
- `cancel()` is preferred over `destroy()` when you want to abort an in-flight
  submission but keep the store usable (e.g. a "Cancel" button).
- `destroy()` must be called from `onDestroy()`; relying on Svelte's automatic
  subscriber teardown alone does not stop SDK-owned TTL watches.
