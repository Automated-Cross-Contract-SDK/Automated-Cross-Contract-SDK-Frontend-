# Getting Started

This guide walks you through installing and using the package.

## Installation

```bash
npm install @your-scope/your-package
```

## Basic usage

```ts
import { createClient } from '@your-scope/your-package';

const client = createClient({ /* options */ });
```

## Transaction history: storage and privacy

When the client submits transactions it can keep a local **transaction history**.
This section documents what that history may contain, how long it is retained,
the encryption requirements for persisted history, and how to disable
persistence entirely.

### What history may contain

Each history entry is a record of a submitted transaction. Depending on the
operation, an entry may include:

- **Transaction hash / id** — the on-chain identifier of the transaction.
- **Operation details** — the operation type and its parameters (e.g. amounts,
  destination accounts, contract ids, function names and arguments).
- **Source account** — the public key of the account that signed the transaction.
- **Status and timestamps** — pending / success / failure state and the times the
  transaction was created and last updated.
- **Result / error data** — the ledger result or error returned by the network.
- **Network identifier** — which network (e.g. testnet, mainnet) the entry belongs to.

History entries contain **public** on-chain data (hashes, public keys, operation
parameters). They do **not** contain secret keys or signed envelopes unless your
application explicitly stores them. Treat history as potentially sensitive
metadata: it can reveal which accounts an application controls and what it does.

### Retention choices

History is retained locally until it is cleared. Applications choose a retention
policy that fits their privacy requirements:

- **Keep indefinitely** — the default; entries accumulate until cleared.
- **Bounded retention** — periodically prune entries older than a chosen window
  (e.g. keep the last 30 days) by clearing and re-adding, or by filtering the
  stored entries on read.
- **Clear on demand** — remove all history when the user logs out or requests it.

Always provide a way for end users to clear their history. When clearing, remove
both the in-memory cache and any persisted copy.

### Encryption requirements for persisted history

If history is persisted to durable storage (disk, `localStorage`, a database),
the storage layer is the application's responsibility and **must** meet these
requirements:

- **Encrypt at rest.** Persisted history must be encrypted with a key the
  application controls; do not write plaintext history to shared or
  world-readable storage.
- **Protect the key.** The encryption key must not be stored alongside the
  ciphertext in the same unprotected location. Derive it from a user secret or
  keep it in the platform's secure storage.
- **Scope access.** Only the owning application/user should be able to read the
  persisted history; enforce access control at the storage boundary.
- **Delete securely.** When history is cleared, delete the ciphertext (and any
  derived keys) so entries cannot be recovered.

In-memory history does not require encryption, but it is lost when the process
ends.

### Disabling persistence

Applications that do not want any history written to durable storage can disable
persistence entirely. History then lives only in memory for the lifetime of the
client and is never written to disk:

```ts
const client = createClient({
  // Do not persist transaction history to durable storage.
  persistHistory: false,
});
```

With persistence disabled:

- No history is written to disk, `localStorage`, or any database.
- In-memory history (if enabled) is discarded when the client is disposed or the
  process exits.
- Clearing history is a no-op beyond dropping the in-memory cache.

If you need history across restarts, keep persistence enabled and apply the
encryption requirements above.

## Next steps

See the API reference for the full set of client options.
