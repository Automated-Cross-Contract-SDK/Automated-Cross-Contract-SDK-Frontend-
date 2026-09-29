# History persistence

`persistHistory` writes transaction history to the `HistoryStorage` you supply
(often `localStorage`, readable by any script on the origin and kept until
removed).

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

Pass a `serializer` to encrypt (or ship to a server) before anything is stored:

```ts
const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
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

new SorobanResurrect({ rpcUrl, persistHistory: { storage: localStorage, serializer } })
```
