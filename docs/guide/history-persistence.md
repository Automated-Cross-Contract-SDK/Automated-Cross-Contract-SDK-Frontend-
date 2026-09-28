# History Persistence

By default, `TransactionHistory` keeps its records in memory only. A page reload
(or an app restart on mobile) discards them, so a restore that failed mid-flight
can no longer be replayed. History persistence is the opt-in feature that lets
you survive a reload and resume a failed restore.

## Opting in

Pass a `HistoryStorage` implementation via `persistHistory` when you construct
the history. Persistence is **off** unless you provide one.

```ts
import { TransactionHistory, persistHistory } from '@soroban-resurrect/sdk'

const history = new TransactionHistory({
  persistHistory: persistHistory({
    storage: window.localStorage,
    networkPassphrase: Networks.TESTNET,
  }),
})
```

## The `HistoryStorage` interface

`persistHistory` accepts any object that satisfies `HistoryStorage`:

```ts
export interface HistoryStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}
```

Both synchronous (`localStorage`) and asynchronous (`AsyncStorage`) backends are
supported. The SDK awaits the result, so you can return a promise from any of the
three methods.

### The default key

If you don't pass a `key`, the SDK uses `DEFAULT_HISTORY_STORAGE_KEY`. Pass an
explicit `key` when you run more than one history instance in the same storage
(e.g. one per network) so they don't clobber each other.

```ts
persistHistory({
  storage: window.localStorage,
  key: 'my-app:history:testnet',
  networkPassphrase: Networks.TESTNET,
})
```

## Hydration timing (`ready`)

Hydration is asynchronous. The in-memory records are **not** available until the
history has finished loading from storage. Await `ready` before reading history
or attempting to replay a failed restore:

```ts
await history.ready

const failed = history.getAll().filter((entry) => entry.status === 'failed')
for (const entry of failed) {
  await resurrect.replay(entry)
}
```

If you read history before `ready` resolves you will see an empty list, which is
indistinguishable from "nothing was ever persisted".

## The `networkPassphrase` requirement

`TransactionHistory.loadJSON` requires a `networkPassphrase`. Persisted entries
are keyed by network, and the passphrase is what lets the SDK reject records
that were written for a different network. Omitting it (or passing the wrong
one) means the stored entries will not be hydrated.

```ts
// loadJSON requires the passphrase — there is no default.
const history = TransactionHistory.loadJSON(stored, {
  networkPassphrase: Networks.TESTNET,
})
```

## What is stored (privacy)

Persistence stores the **full transaction XDR** for every history entry, along
with its status and metadata. That is the same payload you would submit to the
network, so treat the storage backend as sensitive:

- **Full transaction XDR** — the complete, signed-or-unsigned envelope.
- **Status and timestamps** — enough to identify which restores failed.
- **Network passphrase** — used to scope and validate the records.

Because the XDR can contain account addresses and operation details, do not
persist to a shared or unencrypted store on a device you don't control. If your
threat model requires it, wrap the storage in an encrypting adapter that
implements `HistoryStorage`.

## Browser example (`localStorage`)

```ts
import { Networks } from '@stellar/stellar-sdk'
import { TransactionHistory, persistHistory } from '@soroban-resurrect/sdk'

const history = new TransactionHistory({
  persistHistory: persistHistory({
    storage: window.localStorage,
    key: 'soroban-resurrect:history',
    networkPassphrase: Networks.TESTNET,
  }),
})

await history.ready
```

## React Native example (`AsyncStorage`)

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Networks } from '@stellar/stellar-sdk'
import { TransactionHistory, persistHistory } from '@soroban-resurrect/sdk'

const history = new TransactionHistory({
  persistHistory: persistHistory({
    storage: AsyncStorage,
    key: 'soroban-resurrect:history',
    networkPassphrase: Networks.TESTNET,
  }),
})

await history.ready
```

`AsyncStorage` already matches `HistoryStorage`, so no adapter is needed.

## Failure semantics

- If the storage backend throws on read, hydration fails and `ready` rejects.
  Handle the rejection so a corrupt store doesn't take down your app.
- If the stored payload is not valid JSON, the SDK discards it rather than
  throwing on every read.
- Writes are best-effort: a failed `setItem` does not roll back the in-memory
  entry, so the current session still works even if persistence is unavailable.

```ts
try {
  await history.ready
} catch (err) {
  console.warn('History hydration failed; continuing without persisted history', err)
}
```
