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
