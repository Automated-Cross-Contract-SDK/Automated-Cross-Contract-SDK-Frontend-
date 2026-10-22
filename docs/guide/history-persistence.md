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

## ADR: Rebuilding the original transaction after restoration

### Status

Accepted.

### Context

When a restored (resurrected) ledger entry is submitted, the network needs a
transaction that references the restored entry. The SDK keeps the original
transaction envelope in history so it can be re-submitted, but a restored entry
is only valid for a bounded window and the original envelope may have been
built against a stale ledger state. Re-submitting the stored envelope verbatim
is therefore unsafe: its sequence number may already be consumed, its
simulation footprint may no longer match the restored entry, and its fee may be
stale.

### Decision

After restoration, the SDK **rebuilds** the original transaction rather than
reusing the restored envelope. The rebuilt transaction is derived from the
original operation(s) plus fresh network data, and the caller is responsible
for supplying the pieces the SDK cannot infer.

### Rationale

- **Sequence numbers.** A stored envelope carries the account sequence number
  that was current when it was first built. Once that transaction (or any
  later one) is submitted, the stored sequence is consumed and re-submitting it
  fails with `txBAD_SEQ`. Rebuilding fetches the current account sequence and
  applies it, so the rebuilt transaction is valid against the live ledger.
- **Simulation data.** Soroban transactions embed a footprint and resource
  limits produced by simulation. After a restore, the entry's TTL and the
  ledger state differ from the original simulation, so the footprint and
  resource limits must be re-simulated. Rebuilding re-runs simulation against
  the restored state instead of trusting stale results.
- **Fees.** Resource fees depend on the re-simulated resource usage; rebuilding
  recomputes them so the transaction is not rejected for insufficient fees.
- **Safety.** Rebuilding keeps the original intent (the operations) while
  discarding stale, network-dependent fields, which is the only way to produce
  a transaction the network will accept after restoration.

### Mechanism

1. The original operation(s) are read from the stored history entry
   (`transactionXdr` in `'full'` mode).
2. The current account sequence number is fetched from the network and applied
   to the rebuilt transaction.
3. The transaction is re-simulated against the restored ledger state to obtain
   a fresh footprint and resource limits.
4. Fees are recomputed from the re-simulated resource usage.
5. The rebuilt envelope is signed and submitted.

### Caller responsibilities

- **Provide the source account and signer.** The SDK rebuilds the transaction
  but cannot sign on the caller's behalf; the caller must supply a signer for
  the source account.
- **Persist in `'full'` mode to rebuild.** Rebuilding requires the original
  operation(s), which are only stored in `'full'` mode. `'minimal'` records
  keep only metadata and cannot be rebuilt; use `parseMinimalHistory()` to read
  them for display.
- **Handle sequence contention.** If the account submits other transactions
  concurrently, the caller must serialize submissions or retry on
  `txBAD_SEQ`, since the rebuilt sequence can be consumed between build and
  submit.
- **Re-simulate after state changes.** If ledger state changes between rebuild
  and submit, the caller should rebuild again rather than reuse the previous
  envelope.

### Consequences

Rebuilding adds a network round-trip (sequence fetch + simulation) per
submission, but produces transactions that are valid against the live ledger.
Callers that need to re-submit must use `'full'` persistence and provide a
signer; `'minimal'` history remains display-only.
