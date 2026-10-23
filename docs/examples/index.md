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

## Production-Style React Application

[`examples/react-app`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/react-app) is a realistic React + TypeScript application that goes beyond the minimal example. It demonstrates the patterns you need to ship the SDK in production:

- **Routing** — `react-router-dom` with a wallet-gated route tree (`/`, `/wallet`, `/submit`, `/history`).
- **Wallet lifecycle** — connect, disconnect, account/network change handling, and reconnection on reload via a `WalletProvider`.
- **User feedback** — a state-machine-driven progress indicator plus toast notifications for success and failure.
- **Fee consent** — an explicit confirmation dialog before any restore fee is signed, with the estimated fee surfaced to the user.
- **Cancellation** — an `AbortController`-based cancel path that stops in-flight restore/submit work and returns the UI to a clean state.
- **Typed error handling** — a discriminated `Result` type and exhaustive error rendering for every SDK failure mode.

```bash
git clone https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-.git
cd Automated-Cross-Contract-SDK-Frontend-/examples/react-app
npm install
npm run dev
```

### Stable interface

The example exposes a small, documented surface so you can copy it into your own app:

```typescript
// src/sdk/useResurrect.ts
export interface UseResurrectOptions {
  rpcUrl: string
  wallet: WalletAdapter | null
}

export interface UseResurrectResult {
  state: ResurrectState
  submit: (tx: Transaction) => Promise<SubmitResult>
  cancel: () => void
  reset: () => void
}

export function useResurrect(options: UseResurrectOptions): UseResurrectResult
```

`submit` resolves to a typed `SubmitResult` (`{ success: true; originalTxHash: string } | { success: false; error: ResurrectError }`), and `cancel` aborts any in-flight work. The hook is covered by automated tests for the happy path, fee-consent rejection, cancellation, and each typed error branch.

### Compatibility notes

- Requires React 18+ and `react-router-dom` 6+.
- Targets the same SDK version as the rest of the docs; if you upgrade the SDK, update the dependency in `examples/react-app/package.json` to match.
- The wallet adapter is pluggable — the example ships with a Freighter adapter, but any adapter implementing `WalletAdapter` works.

## Vue Application

[`examples/vue-app`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/vue-app) is a Vue 3 + TypeScript application that wires the Vue composable to a wallet connection flow. It demonstrates the full restore lifecycle with explicit UI states:

- **Loading** — a spinner and status label while the wallet connects and while restore/submit work is in flight.
- **Rejection** — a clear message when the user rejects the wallet signature request, with a retry action.
- **Restore success** — the restored transaction hash is surfaced once the original transaction is submitted.
- **Failure** — typed SDK errors are rendered exhaustively, with a reset action to return to a clean state.

```bash
git clone https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-.git
cd Automated-Cross-Contract-SDK-Frontend-/examples/vue-app
npm install
npm run dev
```

### Stable interface

The example exposes a small, documented composable so you can copy it into your own app:

```typescript
// src/composables/useResurrect.ts
export interface UseResurrectOptions {
  rpcUrl: string
  wallet: Ref<WalletAdapter | null>
}

export interface UseResurrectResult {
  state: Ref<ResurrectState>
  loading: Ref<boolean>
  error: Ref<ResurrectError | null>
  submit: (tx: Transaction) => Promise<SubmitResult>
  cancel: () => void
  reset: () => void
}

export function useResurrect(options: UseResurrectOptions): UseResurrectResult
```

`submit` resolves to a typed `SubmitResult` (`{ success: true; originalTxHash: string } | { success: false; error: ResurrectError }`), and `cancel` aborts any in-flight work. The composable is covered by automated tests for the happy path, wallet rejection, restore success, and each typed error branch.

### Compatibility notes

- Requires Vue 3.3+ and `vue-tsc` for type checking.
- Targets the same SDK version as the rest of the docs; if you upgrade the SDK, update the dependency in `examples/vue-app/package.json` to match.
- The wallet adapter is pluggable — the example ships with a Freighter adapter, but any adapter implementing `WalletAdapter` works.

## Minimal Plain JavaScript Example

If you are not using a framework, [`examples/plain-js`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/plain-js) is a dependency-light browser example: a single `index.html` plus `main.js` that loads the SDK from a CDN, connects a wallet, builds a transaction, and demonstrates both the restore and no-restore paths.

```html
<!-- index.html -->
<button id="connect">Connect wallet</button>
<button id="submit">Submit transaction</button>
<pre id="log"></pre>
<script type="module" src="./main.js"></script>
```

```javascript
// main.js — no framework, no build step
import { SorobanResurrect } from 'https://esm.sh/@soroban-resurrect/sdk'

const log = (msg) => (document.getElementById('log').textContent += msg + '\n')

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

sr.onStateChange((info) => log(`[${info.state}] ${info.message}`))

let wallet = null

document.getElementById('connect').addEventListener('click', async () => {
  wallet = await connectWallet() // your wallet adapter, e.g. Freighter
  log(`Connected: ${wallet.publicKey}`)
})

document.getElementById('submit').addEventListener('click', async () => {
  if (!wallet) return log('Connect a wallet first')

  const tx = await buildTransaction(wallet.publicKey) // your contract call

  // No-restore path: submit directly when nothing is archived.
  if (!(await sr.needsRestore(tx))) {
    const result = await sr.submitWithRestore({ transaction: tx, wallet })
    return log(result.success ? `Submitted ${result.originalTxHash}` : `Failed: ${result.error}`)
  }

  // Restore path: archived entries are restored, then the original is submitted.
  const result = await sr.submitWithRestore({
    transaction: tx,
    wallet,
    onRestoreNeeded: (keys) => log(`Restoring ${keys.length} archived entries…`),
    onRestoreFailed: (error) => log(`Restore failed: ${error.message}`),
  })

  log(result.success ? `Submitted ${result.originalTxHash}` : `Failed: ${result.error}`)
})
```

Serve the folder with any static file server (for example `npx serve examples/plain-js`) and open it in a browser. The example targets the same SDK version as the rest of the docs; if you upgrade the SDK, update the CDN URL in `main.js` to match.

## Interactive Playground

A focused token balance example lives at [`examples/token-transfer`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/token-transfer).
It shows the user-visible flow of a token transfer whose balance entry has
archived: the balance is unavailable until the user consents to a restore, and
becomes available again after restoration.

```bash
cd examples/token-transfer
npm install
npm run dev
```

The example exposes a small, stable interface so the balance flow can be reused
and tested independently of the UI:

```typescript
// examples/token-transfer/src/balance.ts
export interface BalanceOptions {
  rpcUrl: string
  contractId: string
  account: string
  wallet: WalletAdapter
}

/**
 * User-visible balance state. `archived` means the balance entry is archived
 * and cannot be read until restored; `recovered` means it was restored and the
 * balance is available again.
 */
export type BalanceStatus = 'available' | 'archived' | 'recovered'

export interface BalanceState {
  status: BalanceStatus
  /** Balance in stroops, present only when status is 'available' or 'recovered'. */
  balance?: bigint
  archivedKeys: ArchivedLedgerEntry[]
  message: string
}

/** Read the balance without signing. Reports 'archived' when unavailable. */
export async function readBalance(options: BalanceOptions): Promise<BalanceState>

/**
 * Restore archived balance entries (requires user consent) and re-read the
 * balance. Returns status 'recovered' with the restored balance.
 */
export async function recoverBalance(options: BalanceOptions): Promise<BalanceState>

/** Transfer tokens, restoring an archived balance first when needed. */
export async function transferWithRecovery(
  options: BalanceOptions,
  to: string,
  amount: bigint,
): Promise<SubmitWithRestoreResult>
```

### Before and after restoration

```typescript
import { readBalance, recoverBalance } from './balance'

// Before: the balance entry is archived, so the balance is unavailable.
const before = await readBalance(options)
// before.status === 'archived', before.balance === undefined

// After the user consents, restore and re-read.
const after = await recoverBalance(options)
// after.status === 'recovered', after.balance === 1000n
```

### Failure and boundary cases

The example's tests cover the expected path plus boundary/failure cases:

- **Archived balance** — `readBalance` reports `status: 'archived'` with no
  `balance` and the archived keys to restore.
- **Recovered balance** — `recoverBalance` reports `status: 'recovered'` with
  the restored balance and an empty `archivedKeys` list.
- **Already available** — a live balance reports `status: 'available'` and its
  balance without prompting for a restore.
- **Consent denied** — `recoverBalance` rejects when the user denies consent and
  leaves the balance archived.
- **Transfer with recovery** — `transferWithRecovery` restores first, then
  submits the transfer, returning the `submitWithRestore` result.

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

## Server-Side Monitoring Example

A backend can observe TTL and restore status without ever touching user signing
keys or submitting transactions on a user's behalf. The example at
[`examples/monitoring`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/monitoring)
uses only read-only RPC calls (`getLedgerEntries` / simulation) to report
whether a contract's ledger entries are live, archived, or already restored.

```bash
cd examples/monitoring
npm install
npm run start -- --rpc-url https://soroban-testnet.stellar.org --contract C...
```

It exposes a small, stable interface so the monitoring logic can be reused and
tested independently of any wallet:

```typescript
// examples/monitoring/src/monitor.ts
export interface MonitorOptions {
  rpcUrl: string
  contractId: string
  /** Ledger keys to observe. Defaults to the contract instance entry. */
  keys?: LedgerKey[]
}

export type MonitorStatus = 'live' | 'archived' | 'restored' | 'missing'

export interface MonitorReport {
  contractId: string
  status: MonitorStatus
  /** Remaining TTL in ledgers, when the entry is live. */
  liveUntilLedger?: number
  archivedKeys: ArchivedLedgerEntry[]
  checkedAt: string
}

// checkStatus performs read-only RPC calls only. It never signs or submits.
export async function checkStatus(options: MonitorOptions): Promise<MonitorReport>
```

### Read-only observation only

The monitor never accepts a `WalletAdapter` and never calls `submitWithRestore`.
It only reads ledger state, so it is safe to run on a server with no secrets:

```typescript
import { checkStatus } from './monitor'

const report = await checkStatus({
  rpcUrl: process.env.SOROBAN_RPC_URL!,
  contractId: process.env.CONTRACT_ID!,
})

if (report.status === 'archived') {
  // Alert operators; a user (not the server) must restore before submitting.
  console.warn(`${report.archivedKeys.length} entries archived for ${report.contractId}`)
}
```

### Failure and boundary cases

The example's tests cover the expected path plus boundary/failure cases:

- **Missing contract** — an unknown `contractId` reports `status: 'missing'`.
- **RPC error** — a failing RPC call rejects with the underlying error rather
  than reporting a false `live` status.
- **Already restored** — entries that were archived and have since been restored
  report `status: 'restored'` with an empty `archivedKeys` list.
- **Live entry** — a live entry reports `status: 'live'` and its `liveUntilLedger`.

## Multi-Network Example App

A multi-network example lives at [`examples/multi-network`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/multi-network).
It demonstrates switching between testnet and public-network configuration and
refuses to sign when the connected wallet's network does not match the
configured network.

```bash
cd examples/multi-network
npm install
npm run dev
```

The example exposes a small, stable interface so the network selection and
mismatch guard can be reused and tested independently of the UI:

```typescript
// examples/multi-network/src/network.ts
export type NetworkName = 'testnet' | 'public'

export interface NetworkConfig {
  name: NetworkName
  rpcUrl: string
  networkPassphrase: string
}

export const NETWORKS: Record<NetworkName, NetworkConfig>

/**
 * Resolve the configured network. Throws for an unknown name so a typo can
 * never silently fall back to a different network.
 */
export function resolveNetwork(name: NetworkName): NetworkConfig

/**
 * Guard that must pass before any signing happens. Throws
 * `NetworkMismatchError` when the wallet's network does not match the
 * configured network, so a transaction is never signed against the wrong
 * network.
 */
export function assertNetworkMatch(
  configured: NetworkConfig,
  walletNetwork: NetworkName,
): void
```

### Estimating restore fees and asking for consent

Restore fees are separate from the original transaction cost. Estimate both,
show them side by side, and only proceed once the user explicitly consents to
the extra restore fee. See [Restore fees](/guide/restore-fees) for the full
fee model and consent patterns.

```typescript
const estimate = await sr.estimateRestoreFees(tx)
// estimate.originalFee  — cost of the original transaction
// estimate.restoreFee   — extra cost to restore archived entries
// estimate.totalFee     — originalFee + restoreFee

const consent = await requestConsent({
  title: 'Restore required',
  body:
    `This transaction needs ${estimate.archivedKeys.length} archived ` +
    `entries restored.\n\n` +
    `Original transaction fee: ${formatStroops(estimate.originalFee)}\n` +
    `Restore fee: ${formatStroops(estimate.restoreFee)}\n` +
    `Total: ${formatStroops(estimate.totalFee)}`,
  confirmLabel: 'Pay restore fee and continue',
  cancelLabel: 'Cancel',
})

if (!consent) return // user declined — do not submit

const result = await sr.submitWithRestore({ transaction: tx, wallet })
```

### Full submit flow with error handling

```typescript
import { NETWORKS, resolveNetwork, assertNetworkMatch } from './network'

// The user explicitly picks a network; there is no implicit default.
const configured = resolveNetwork('testnet')

// Before signing, verify the wallet is on the same network.
assertNetworkMatch(configured, wallet.network)

const sr = new SorobanResurrect({ rpcUrl: configured.rpcUrl })
```

### Mismatch guard

```typescript
try {
  assertNetworkMatch(NETWORKS.public, wallet.network)
} catch (error) {
  if (error instanceof NetworkMismatchError) {
    // Prompt the user to switch the wallet network before retrying.
    showSwitchNetworkPrompt(error.expected, error.actual)
  }
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
