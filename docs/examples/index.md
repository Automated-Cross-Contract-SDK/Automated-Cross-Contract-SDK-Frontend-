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

## Custom RPC Client Injection

The SDK accepts a custom RPC client through the `rpcClient` option. This is the
supported way to wrap the RPC transport for logging, proxying, or testing
without changing the standard SDK workflow — every SDK call still goes through
the same `SorobanResurrect` API.

### Interface

A custom client implements the `RpcClient` interface: it exposes the same
methods the SDK uses internally (`getAccount`, `simulateTransaction`,
`sendTransaction`, `getTransaction`, `getLatestLedger`). Wrap an existing client
to add behavior, then pass it in via `rpcClient`.

### Logging wrapper

```typescript
import { SorobanResurrect, type RpcClient } from '@soroban-resurrect/sdk'

function withLogging(inner: RpcClient): RpcClient {
  return {
    getAccount: (id) => {
      console.debug('[rpc] getAccount', id)
      return inner.getAccount(id)
    },
    simulateTransaction: (tx) => {
      console.debug('[rpc] simulateTransaction')
      return inner.simulateTransaction(tx)
    },
    sendTransaction: (tx) => {
      console.debug('[rpc] sendTransaction')
      return inner.sendTransaction(tx)
    },
    getTransaction: (hash) => {
      console.debug('[rpc] getTransaction', hash)
      return inner.getTransaction(hash)
    },
    getLatestLedger: () => {
      console.debug('[rpc] getLatestLedger')
      return inner.getLatestLedger()
    },
  }
}

const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  rpcClient: withLogging(defaultRpcClient),
})
```

### Testing with a mock client

```typescript
import { SorobanResurrect, type RpcClient } from '@soroban-resurrect/sdk'

const mockRpc: RpcClient = {
  getAccount: async () => ({ accountId: 'G...', sequence: '1' }),
  simulateTransaction: async () => ({ success: true, archivedKeys: [] }),
  sendTransaction: async () => ({ hash: 'deadbeef', status: 'PENDING' }),
  getTransaction: async () => ({ status: 'SUCCESS' }),
  getLatestLedger: async () => ({ sequence: 1 }),
}

const sr = new SorobanResurrect({ rpcUrl: 'unused', rpcClient: mockRpc })
```

### Compatibility notes

- `rpcClient` is optional; when omitted the SDK builds its default client from
  `rpcUrl`, so existing code keeps working unchanged.
- A custom client must implement every method of `RpcClient`; partial wrappers
  should delegate the remaining methods to the inner client (as in the logging
  example above).
- Errors thrown by a custom client propagate to the SDK's normal error handling
  (`onRestoreFailed`, `result.error`), so no extra handling is required.

## Wallet-Free Test Example with the Mock RPC Harness

This example shows how to exercise the SDK's success, failure, and restore
scenarios in automated tests **without a live network or a wallet extension**.
It uses the mock RPC harness that ships with the SDK's test utilities, so you
do not need to hand-roll a fake `RpcClient` for every test.

### Harness interface

The harness is a small, stable helper exported from the SDK's testing entry
point. It wraps a scripted `RpcClient` and records every call so tests can
assert on the RPC traffic the SDK produced.

```typescript
import { createMockRpcHarness } from '@soroban-resurrect/sdk/testing'

const harness = createMockRpcHarness({
  // Optional: seed the ledger sequence returned by getLatestLedger.
  latestLedger: 1,
})

// harness.client  — an RpcClient to pass via the `rpcClient` option
// harness.calls   — ordered list of { method, args } recorded during the test
// harness.reset() — clear recorded calls and queued responses between tests
```

Responses are scripted per method. Each queued response is consumed in order;
when the queue is empty the harness falls back to a sensible default (e.g. a
successful simulation with no archived keys).

```typescript
harness.on('simulateTransaction', { success: true, archivedKeys: [] })
harness.on('sendTransaction', { hash: 'deadbeef', status: 'PENDING' })
harness.on('getTransaction', { status: 'SUCCESS' })
```

### Success path

```typescript
import { describe, it, expect } from 'vitest'
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { createMockRpcHarness } from '@soroban-resurrect/sdk/testing'

it('submits without restoring when nothing is archived', async () => {
  const harness = createMockRpcHarness()
  harness.on('simulateTransaction', { success: true, archivedKeys: [] })
  harness.on('sendTransaction', { hash: 'deadbeef', status: 'PENDING' })
  harness.on('getTransaction', { status: 'SUCCESS' })

  const sr = new SorobanResurrect({ rpcUrl: 'unused', rpcClient: harness.client })
  const result = await sr.submitWithRestore({ transaction: tx, wallet: fakeWallet })

  expect(result.success).toBe(true)
  expect(harness.calls.map((c) => c.method)).toEqual([
    'simulateTransaction',
    'sendTransaction',
    'getTransaction',
  ])
})
```

### Failure path

```typescript
it('surfaces a failed submission through result.error', async () => {
  const harness = createMockRpcHarness()
  harness.on('simulateTransaction', { success: true, archivedKeys: [] })
  harness.on('sendTransaction', { hash: 'deadbeef', status: 'PENDING' })
  harness.on('getTransaction', { status: 'FAILED' })

  const sr = new SorobanResurrect({ rpcUrl: 'unused', rpcClient: harness.client })
  const result = await sr.submitWithRestore({ transaction: tx, wallet: fakeWallet })

  expect(result.success).toBe(false)
  expect(result.error).toBeDefined()
})
```

### Restore path

```typescript
it('restores archived entries before submitting the original tx', async () => {
  const harness = createMockRpcHarness()
  harness.on('simulateTransaction', {
    success: false,
    archivedKeys: [{ key: 'position' }],
  })
  harness.on('sendTransaction', { hash: 'restorehash', status: 'PENDING' })
  harness.on('getTransaction', { status: 'SUCCESS' })

  const sr = new SorobanResurrect({ rpcUrl: 'unused', rpcClient: harness.client })
  const onRestoreNeeded = vi.fn()
  const result = await sr.submitWithRestore({
    transaction: tx,
    wallet: fakeWallet,
    onRestoreNeeded,
  })

  expect(onRestoreNeeded).toHaveBeenCalledWith([{ key: 'position' }])
  expect(result.success).toBe(true)
})
```

### Boundary cases

- **Empty archived keys** — a simulation that reports `archivedKeys: []` must
  skip the restore step entirely (see the success path above).
- **Restore failure** — script `sendTransaction` to reject or `getTransaction`
  to return `FAILED` during the restore phase; the SDK should call
  `onRestoreFailed` and leave the original transaction unsubmitted.
- **Reset between tests** — call `harness.reset()` in `afterEach` so queued
  responses and recorded calls do not leak across tests.

### Compatibility notes

- The harness is a test-only helper; it is not part of the runtime bundle and
  does not affect production code paths.
- It produces a plain `RpcClient`, so it works with any SDK version that
  supports the `rpcClient` option — no migration is required for existing tests.
- If you already hand-roll a mock `RpcClient`, you can keep it; the harness is
  an optional convenience that adds call recording and response scripting.

## DeFi Position Recovery with Fee Review

This example restores an archived DeFi contract position (e.g. a lending
supply position) and shows how a dApp can present the recovery transaction and
its fees to the user **before** anything is signed.

### 1. Detect whether the position needs recovery

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

// `positionTx` is the transaction that touches the archived position entry.
const needsRestore = await sr.needsRestore(positionTx)
if (!needsRestore) {
  // Position is live — submit directly.
  return
}
```

### 2. Build a recovery preview (transaction + fees) for review

```typescript
import type { RestorePreview } from '@soroban-resurrect/sdk'

// `prepareRestore` returns the unsigned restore transaction together with the
// fee breakdown, without submitting or signing anything.
const preview: RestorePreview = await sr.prepareRestore({
  transaction: positionTx,
  wallet,
})

// preview.restoreTransaction — unsigned restore tx (XDR + decoded)
// preview.fees.baseFee         — base fee for the restore tx
// preview.fees.resourceFee     — resource fee for the restore tx
// preview.fees.totalFee        — total fee the user will pay
// preview.fees.originalTxFee   — fee of the original position tx
// preview.archivedKeys         — ledger entries that will be restored
```

### 3. Present the recovery transaction and fees before signing

```tsx
function RecoveryReview({ preview, onConfirm }: {
  preview: RestorePreview
  onConfirm: () => void
}) {
  return (
    <section className="recovery-review">
      <h2>Recover DeFi position</h2>
      <p>
        {preview.archivedKeys.length} archived ledger{' '}
        {preview.archivedKeys.length === 1 ? 'entry' : 'entries'} will be restored
        before your position transaction can be submitted.
      </p>

      <dl className="fees">
        <dt>Restore base fee</dt>
        <dd>{preview.fees.baseFee} stroops</dd>
        <dt>Restore resource fee</dt>
        <dd>{preview.fees.resourceFee} stroops</dd>
        <dt>Position transaction fee</dt>
        <dd>{preview.fees.originalTxFee} stroops</dd>
        <dt>Total</dt>
        <dd>{preview.fees.totalFee} stroops</dd>
      </dl>

      <button onClick={onConfirm}>Sign recovery &amp; position</button>
    </section>
  )
}
```

### 4. Sign and submit after the user confirms

```typescript
async function confirmRecovery(preview: RestorePreview, wallet: WalletAdapter) {
  const result = await sr.submitWithRestore({
    transaction: preview.restoreTransaction,
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
