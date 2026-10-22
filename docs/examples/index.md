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

## Token Transfer with Archived Balance Recovery

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

### Explicit network switching

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

### Failure and boundary cases

The example's tests cover the expected path plus boundary/failure cases:

- **Matching network** — `assertNetworkMatch` resolves when the wallet network
  equals the configured network.
- **Mismatched network** — signing is blocked with `NetworkMismatchError` when
  the wallet is on a different network than the configured one.
- **Unknown network name** — `resolveNetwork` throws instead of falling back to
  a default network.

## Interactive Playground

Want to try the flow without installing anything? The
[Interactive Playground](/examples/playground

/* … truncated 1934 chars — edit only what you need near the top … */
