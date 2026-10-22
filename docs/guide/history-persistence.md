# History persistence

`persistHistory` writes transaction history to the `HistoryStorage` you supply
(often `localStorage`, readable by any script on the origin and kept until
removed).

`HistoryStorage` is a stable, platform-neutral interface:

```ts
interface HistoryStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
}
```

Web Storage satisfies this interface synchronously; React Native
`AsyncStorage` satisfies it asynchronously. Do not evaluate browser globals
while importing a module or rendering on the server. Create a browser-backed
SDK only in a client lifecycle, and wait for `sdk.ready` before reading history:

```tsx
useEffect(() => {
  const browserStorage = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  }
  const sdk = new SorobanResurrect({
    rpcUrl,
    persistHistory: { storage: browserStorage, mode: 'minimal' },
  })
  let mounted = true

  void sdk.ready.then(() => {
    if (mounted) setHistory(sdk.getHistory())
  })

  return () => {
    mounted = false
    sdk.dispose()
  }
}, [rpcUrl])
```

For React Native, pass the platform store directly:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'

const sdk = new SorobanResurrect({
  rpcUrl,
  persistHistory: { storage: AsyncStorage, mode: 'full' },
})
await sdk.ready
```

## What leaves memory

| Mode | Fields written per entry |
| --- | --- |
| `'minimal'` (**recommended**) | `id`, `timestamp`, `status`, `attemptCount`, `lastAttemptAt`, `transactionHash` |
| `'full'` (default) | `id`, `timestamp`, `transactionXdr` (full envelope), `result` (full `ResurrectResult`), `status`, `attemptCount`, `lastAttemptAt` |

Full XDR discloses contract ids, ledger keys, amounts and counterparties. Prefer
`'minimal'`; minimal records are not rehydrated into the live history — read
them with `parseMinimalHistory()`.

```ts
new SorobanResurrect({
  rpcUrl,
  persistHistory: { storage: localStorage, mode: 'minimal' },
})
```

## Encrypted storage

Pass a `serializer` to encrypt (or ship to a server) before anything is stored.
The key must survive app restarts and be stored separately from the history
(for example, in the platform keychain/keystore). Never store the key alongside
the ciphertext, and do not use a newly generated in-memory key on every launch:
that makes prior history permanently unreadable. Browser `localStorage` is
accessible to same-origin JavaScript, so encryption does not protect against
active XSS; prefer minimal mode and a platform secure store when appropriate.
In the example below, `storage` is the adapter for the selected platform.

```ts
// Obtain this persistent key from a secure platform key store.
const key = await getPersistentEncryptionKey()
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const serializer = {
  async serialize(plain: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
    return `${b64(iv.buffer)}.${b64(ct)}`
  },
  async deserialize(stored: string) {
    const [iv, ct] = stored.split('.').map(unb64)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(pt)
  },
}

new SorobanResurrect({ rpcUrl, persistHistory: { storage, serializer } })
```

## Example: token transfer with archived balance recovery

This walkthrough shows the user-visible flow for a token balance that has been
archived on-chain: the balance reads as unavailable, the SDK restores the
archived entry, and the transfer then succeeds with the recovered balance.

### Before restoration

When the balance entry is archived, reads return no balance and a transfer
would fail. Surface this state to the user instead of showing a stale amount:

```ts
const balance = await token.balanceOf(account)
if (balance === null) {
  // Archived: the ledger entry is no longer live.
  showArchivedState(account) // e.g. "Balance unavailable — restore to continue"
}
```

### Restore and transfer

Call `restore` for the archived keys, wait for `sdk.ready`, then re-read the
balance and submit the transfer. The same `persistHistory` configuration from
above records the restore and transfer so the flow survives reloads.

```ts
const sdk = new SorobanResurrect({
  rpcUrl,
  persistHistory: { storage, mode: 'minimal' },
})
await sdk.ready

// 1. Restore the archived balance entry.
const restore = await sdk.restore({ contractId: tokenId, keys: [balanceKey(account)] })
if (restore.status !== 'success') {
  showRestoreFailure(restore) // e.g. insufficient fee, footprint mismatch
  return
}

// 2. Re-read the now-live balance.
const recovered = await token.balanceOf(account)
if (recovered === null) {
  showRestoreFailure(restore) // restore reported success but entry still missing
  return
}

// 3. Transfer using the recovered balance.
const transfer = await token.transfer({ from: account, to: recipient, amount })
showTransferResult(transfer)
```

### After restoration

The balance is live again and the transfer completes. The history entry written
by the SDK lets you show the recovery in the UI:

```ts
const [entry] = sdk.getHistory()
// entry.status === 'success', entry.transactionHash is the transfer hash
```

### Boundary and failure cases

- **Restore fails** (`restore.status !== 'success'`): keep the archived state
  visible and let the user retry; do not attempt the transfer.
- **Balance still missing after restore**: treat as a failure even if the
  restore call reported success, and surface it to the user.
- **Transfer fails after a successful restore**: the balance is live, so the
  user can retry the transfer without restoring again.
- **Reload mid-flow**: with `persistHistory` configured, `sdk.getHistory()`
  after `sdk.ready` shows the restore/transfer attempts so the UI can resume.

### Compatibility and migration

This example uses the same `HistoryStorage` interface and `persistHistory`
options documented above; no new configuration is required. If you previously
stored history with `mode: 'full'`, switching to `'minimal'` is safe for this
example — read prior records with `parseMinimalHistory()` and keep the existing
`storage` adapter unchanged.
