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

## Integrating the SDK into an existing dApp

This tutorial adds the SDK to an application that already works, without
rewriting it. It covers the wallet signing flow, failure UX, and a repeatable
verification flow so you can confirm the integration works.

### Step 1 — Install and configure the client

Add the package to your existing project and create a single client instance at
startup. Keep the configuration in one module so every call site shares it:

```ts
// src/sdk.ts
import { createClient } from '@your-scope/your-package';

export const client = createClient({
  network: 'testnet',
  // Persist history only if your storage layer meets the encryption
  // requirements above; otherwise keep it in memory.
  persistHistory: false,
});
```

### Step 2 — Wire up wallet signing

Your dApp already has a connected wallet. Pass the wallet's signing function to
the SDK instead of handling keys yourself — the SDK builds the transaction and
the wallet prompts the user to sign:

```ts
import { client } from './sdk';

async function submitPayment(destination: string, amount: string) {
  const result = await client.submit({
    operation: { type: 'payment', destination, amount },
    // The wallet owns the secret key and shows its own approval prompt.
    sign: (envelope) => wallet.signTransaction(envelope),
  });
  return result;
}
```

Never read or store the user's secret key in your application; the wallet is the
only component that signs.

### Step 3 — Handle failures with clear UX

Submissions can fail at several points: the user rejects the signature request,
the network rejects the transaction, or the request times out. Surface each case
distinctly instead of a generic error:

```ts
import { client } from './sdk';

try {
  const result = await submitPayment(destination, amount);
  showSuccess(result.hash);
} catch (err) {
  if (err.code === 'USER_REJECTED') {
    // The user declined the wallet prompt — not an error to alarm them about.
    showNotice('Signature cancelled. Nothing was submitted.');
  } else if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT') {
    // Safe to retry; the transaction may not have been submitted.
    showRetry('Could not reach the network. Please try again.');
  } else {
    // The network rejected the transaction (e.g. insufficient balance).
    showError(err.message);
  }
}
```

Guidelines for failure UX:

- Treat a user-rejected signature as a normal outcome, not an error.
- Offer a retry for transient network failures and timeouts.
- Show the network's rejection reason for validation failures.
- Never display raw error objects or secret material to the user.

### Step 4 — Verify the integration

Run this repeatable check after wiring the SDK in. It exercises the happy path
and the failure path so you can confirm both work:

1. **Happy path** — submit a small payment on testnet. Confirm the wallet prompt
   appears, approve it, and verify the returned hash appears in your history and
   on a block explorer.
2. **User rejection** — submit again and decline the wallet prompt. Confirm your
   UI shows the cancellation notice and no transaction is submitted.
3. **Network failure** — disable the network (or point at an unreachable
   endpoint) and submit. Confirm the retry UI appears.
4. **History** — confirm the successful transaction is recorded and that
   clearing history removes it from both memory and any persisted store.

Repeat these steps on every change to the integration; they cover the expected
path and the relevant failure cases.

## Next steps

See the API reference for the full set of client options.
