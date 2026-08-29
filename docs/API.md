# API Reference

This document is a consolidated reference for the public API of
`@soroban-resurrect/sdk` and `@soroban-resurrect/react-hook`. Every export
listed here also carries full JSDoc (parameters, return values, `@throws`,
`@see`, and `@example`) directly in source — hover it in your editor for
inline docs, or read the linked source file below.

For a narrative walkthrough of how these pieces fit together, see
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Contents

- [`@soroban-resurrect/sdk`](#soroban-resurrectsdk)
  - [`SorobanResurrect`](#sorobanresurrect)
  - [`executeWithRestore`](#executewithrestore)
  - [Archiver functions](#archiver-functions)
  - [Restorer functions](#restorer-functions)
  - [RPC Client Injection](#rpc-client-injection)
  - [Processing State Helpers](#processing-state-helpers)
  - [Types](#types)
- [`@soroban-resurrect/react-hook`](#soroban-resurrectreact-hook)
  - [`SorobanResurrectProvider` / `useSorobanResurrectContext`](#sorobanresurrectprovider--usesorobanresurrectcontext)
  - [`useSorobanResurrect`](#usesorobanresurrect)

---

## `@soroban-resurrect/sdk`

Source: [`packages/sdk/src`](../packages/sdk/src)

### `SorobanResurrect`

Source: [`SorobanResurrect.ts`](../packages/sdk/src/SorobanResurrect.ts)

The main facade class. Wraps a Soroban RPC server, detects archived ledger
entries, and drives the full restore-and-submit workflow while publishing
state transitions to subscribers.

```ts
new SorobanResurrect(config: SorobanResurrectConfig)
```

| Member | Signature | Description |
| --- | --- | --- |
| `server` | `readonly rpc.Server` | The underlying Soroban RPC server instance. |
| `config` | `readonly Required<SorobanResurrectConfig>` | Resolved configuration with defaults applied. Builds a default `SorobanRpcClient` from `rpcUrl` unless `rpcClient` is supplied — see [RPC Client Injection](#rpc-client-injection). |
| `state` | `get state(): RestoreState` | Current workflow state. |
| `stateInfo` | `get stateInfo(): RestoreStateInfo` | Snapshot of state, message, archived keys, and error. |
| `onStateChange` | `(listener: (info: RestoreStateInfo) => void) => () => void` | Subscribe to state transitions. Returns an unsubscribe function. |
| `reset` | `(): void` | Reset back to `idle`, clearing archived keys and errors. |
| `simulate` | `(transaction: Transaction) => Promise<SimulateResponse>` | Simulate a transaction; sets state to `simulating`. |
| `detectArchivedKeys` | `(transaction: Transaction) => Promise<ArchivedLedgerEntry[]>` | Detect archived entries using the configured detection method. Never throws. |
| `needsRestore` | `(transaction: Transaction) => Promise<boolean>` | Convenience boolean wrapper around `detectArchivedKeys`. |
| `buildRestoreTx` | `(sourcePublicKey: string, transaction: Transaction, simulationResponse?) => Promise<Transaction>` | Build an unsigned restore transaction. **Throws** if no restore is needed. |
| `submitWithRestore` | `(options: SubmitWithRestoreOptions) => Promise<ResurrectResult>` | Full workflow: detect → restore (if needed) → submit original. Never throws — failures are returned in the result. |

```ts
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const resurrect = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

const unsubscribe = resurrect.onStateChange((info) => console.log(info.state, info.message))

const result = await resurrect.submitWithRestore({
  transaction: tx,
  wallet,
  onRestoreNeeded: (keys) => console.log(`Restoring ${keys.length} entries`),
})

if (!result.success) {
  console.error(result.error)
}

unsubscribe()
```

### `executeWithRestore`

Source: [`Executor.ts`](../packages/sdk/src/Executor.ts)

```ts
function executeWithRestore(params: ExecuteParams): Promise<ResurrectResult>
```

Lower-level, stateless orchestration function that `SorobanResurrect.submitWithRestore`
wraps. Useful if you want to drive the restore workflow without the
class's built-in state machine. Never throws — every failure path returns
a `ResurrectResult` with `success: false`.

### Archiver functions

Source: [`Archiver.ts`](../packages/sdk/src/Archiver.ts)

| Function | Description |
| --- | --- |
| `isRestoreResponse(response)` | Type guard: does the simulation response require a restore? |
| `isSuccessResponse(response)` | Type guard: did the simulation succeed with no restore needed? |
| `isErrorResponse(response)` | Type guard: did the simulation fail? |
| `extractArchivedKeys(response)` | Extract archived ledger keys from a restore response's footprint. |
| `extractFootprintFromSuccess(response)` | Extract `{ readOnly, readWrite }` keys from a success response's footprint. |
| `detectArchivedEntries(server, ledgerKeys)` | Query the ledger directly to find which of the given keys are archived. Errors per-chunk are treated conservatively as archived. |
| `detectArchivedKeysViaSimulation(server, transaction)` | Simulation-based detection strategy (default). |
| `detectArchivedKeysViaDirect(server, transaction)` | Direct-ledger-query detection strategy. **Throws** if simulation fails or already indicates a restore is needed. |

### Restorer functions

Source: [`Restorer.ts`](../packages/sdk/src/Restorer.ts)

| Function | Description |
| --- | --- |
| `buildRestoreTransaction(params)` | Build an unsigned `restoreFootprint` transaction. Fee = `minResourceFee * restoreFeeMultiplier`. |
| `waitForTransaction(server, hash, pollIntervalMs?, pollTimeoutMs?)` | Poll until a transaction reaches `SUCCESS`/`FAILED`, with exponential backoff + jitter. **Throws** on timeout. |
| `extractXdrOperations(tx)` | Extract raw XDR operations from a transaction, handling fee-bump envelopes. |
| `buildOriginalAfterRestore(server, originalTx, networkPassphrase, fee)` | Rebuild the original transaction after a successful restore (fresh sequence number + re-simulation). **Throws** if restoration was insufficient. |
| `prepareTransaction(server, tx)` | Simulate and assemble a transaction in one step. **Throws** on simulation error or if a restore is required. |

### RPC Client Injection

Source: [`RpcClient.ts`](../packages/sdk/src/RpcClient.ts)

By default, `SorobanResurrect` talks to the network through a `SorobanRpcClient`
that it builds internally from `config.rpcUrl`. To inject a custom transport —
a caching proxy, a logging wrapper, a rate-limiter, or a test double — pass
`config.rpcClient` instead. Every SDK function that talks to the network
(`SorobanResurrect`, `executeWithRestore`, the `Archiver`/`Restorer` free
functions) is typed against `ISorobanRpcClient`, not the concrete
`rpc.Server` class, so any conforming object works.

| Export | Description |
| --- | --- |
| `ISorobanRpcClient` (type) | Minimal interface covering the six `rpc.Server` methods the SDK uses: `simulateTransaction`, `sendTransaction`, `getTransaction`, `getAccount`, `getLedgerEntries`, `getLatestLedger`. |
| `SorobanRpcClient` | Default implementation — a thin, transparent wrapper that delegates every call to an underlying `rpc.Server`. |
| `createRpcClient(rpcUrl)` | Factory that returns a `SorobanRpcClient` bound to `rpcUrl`. The recommended way to build a client you intend to wrap or inject. |

**Inject a custom client:**

```ts
import { createRpcClient, SorobanResurrect } from '@soroban-resurrect/sdk'

const client = createRpcClient('https://soroban-testnet.stellar.org')
const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  rpcClient: client,
})
```

**Wrap it with caching/logging** (see the runnable version in
[`docs/guide/rpc-client-injection.md`](./guide/rpc-client-injection.md)):

```ts
import { createRpcClient, type ISorobanRpcClient } from '@soroban-resurrect/sdk'

function withLogging(client: ISorobanRpcClient): ISorobanRpcClient {
  return {
    ...client,
    async getLatestLedger(...args) {
      console.log('[rpc] getLatestLedger')
      return client.getLatestLedger(...args)
    },
  }
}

const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  rpcClient: withLogging(createRpcClient('https://soroban-testnet.stellar.org')),
})
```

**Test doubles:** implement `ISorobanRpcClient` directly — TypeScript enforces
that every required method is present, so a mock can't silently omit one:

```ts
import type { ISorobanRpcClient } from '@soroban-resurrect/sdk'
import { vi } from 'vitest'

const mockClient: ISorobanRpcClient = {
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getAccount: vi.fn(),
  getLedgerEntries: vi.fn(),
  getLatestLedger: vi.fn(),
}

const sdk = new SorobanResurrect({ rpcUrl: '...', rpcClient: mockClient })
```

### Processing State Helpers

Source: [`stateUtils.ts`](../packages/sdk/src/stateUtils.ts)

Every framework hook (`react-hook`, `vue-hook`, `svelte-hook`) derives its
`isProcessing` flag from these two exports rather than duplicating the state
list — they are the single source of truth for what counts as "in flight".

| Export | Description |
| --- | --- |
| `PROCESSING_STATES` | `Set<RestoreState>` containing every state considered actively in-flight. |
| `isProcessingState(state)` | Predicate: `PROCESSING_STATES.has(state)`. |

`PROCESSING_STATES` contains: `simulating`, `signing_restore`,
`submitting_restore`, `confirming_restore`, `signing_original`,
`submitting_original`.

It excludes `idle`, `success`, and `error` because those are terminal or
not-yet-started — no operation is running. It also excludes
**`restore_needed`**: that state is set the instant archived entries are
detected, as a notification that a restore is about to happen, but no
network call or wallet prompt is in flight yet at that exact point — the
workflow moves on to `signing_restore` (or, in `submitWithRestore`, straight
into the restore flow) immediately after. Treating `restore_needed` as
"processing" would make UI spinners appear one tick before there's actually
anything to wait on.

```ts
import { isProcessingState, PROCESSING_STATES } from '@soroban-resurrect/sdk'

isProcessingState('confirming_restore') // true
isProcessingState('restore_needed')     // false
isProcessingState('idle')               // false

PROCESSING_STATES.has('signing_original') // true
```

Each hook's `isProcessing` field (React's `useSorobanResurrect` /
`useSorobanResurrectContext`, Vue's `useSorobanResurrect` composable, and
Svelte's `createSorobanResurrect` store) is computed by calling
`isProcessingState(state.state)` — see
[React Hook API](./api/react-hook.md#isprocessing-contract) for the React
return shape, and each hook's source (`packages/vue-hook/src/useSorobanResurrect.ts`,
`packages/svelte-hook/src/createSorobanResurrect.ts`) for the Vue/Svelte
equivalents.

### Types

Source: [`types.ts`](../packages/sdk/src/types.ts)

- `SorobanResurrectConfig` — constructor options (`rpcUrl`, `networkPassphrase?`, `pollIntervalMs?`, `pollTimeoutMs?`, `restoreFeeMultiplier?`, `archiveDetectionMethod?`, `rpcClient?`). See [RPC Client Injection](#rpc-client-injection) for `rpcClient`.
- `ISorobanRpcClient` — interface for injectable RPC transports/test doubles. See [RPC Client Injection](#rpc-client-injection).
- `WalletAdapter` — `isConnected()`, `getPublicKey()`, `signTransaction(xdr, opts?)`.
- `ArchivedLedgerEntry` — `{ key: xdr.LedgerKey, keyBase64: string }`.
- `SimulateResponse` — alias for `rpc.Api.SimulateTransactionResponse`.
- `ResurrectResult` — `{ success, originalTxHash?, restoreTxHash?, archivedKeysDetected, error? }`.
- `SubmitWithRestoreOptions` — `{ transaction, wallet, ...lifecycle callbacks }`.
- `RestoreState` — the workflow's state machine states (see `ARCHITECTURE.md` for the diagram).
- `RestoreStateInfo` — `{ state, message, archivedKeys?, error? }`.

---

## `@soroban-resurrect/react-hook`

Source: [`packages/react-hook/src`](../packages/react-hook/src)

### `SorobanResurrectProvider` / `useSorobanResurrectContext`

Source: [`SorobanResurrectContext.tsx`](../packages/react-hook/src/SorobanResurrectContext.tsx)

Context-based integration — instantiate the SDK once at the top of your
component tree, then consume it anywhere below.

```tsx
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

function App() {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: 'https://soroban-testnet.stellar.org' }}>
      <WithdrawButton />
    </SorobanResurrectProvider>
  )
}

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()
  // useSorobanResurrectContext throws if called outside <SorobanResurrectProvider>
  return (
    <button onClick={() => submitWithRestore(tx, wallet)} disabled={isProcessing}>
      {isProcessing ? state.message : 'Withdraw'}
    </button>
  )
}
```

`useSorobanResurrectContext()` returns:

| Field | Type | Description |
| --- | --- | --- |
| `resurrect` | `SorobanResurrect \| null` | Underlying SDK instance. |
| `config` | `SorobanResurrectConfig` | Config passed to the provider. |
| `state` | `RestoreStateInfo` | Current workflow state snapshot. |
| `isProcessing` | `boolean` | `true` while a restore/submit is in flight. |
| `submitWithRestore` | `(tx, wallet) => Promise<ResurrectResult>` | Bound convenience wrapper. |
| `detectArchivedKeys` | `(tx) => Promise<ArchivedLedgerEntry[]>` | Bound convenience wrapper. |
| `reset` | `() => void` | Reset state back to `idle`. |

### `useSorobanResurrect`

Source: [`useSorobanResurrect.ts`](../packages/react-hook/src/useSorobanResurrect.ts)

Standalone hook for components that don't sit under a
`SorobanResurrectProvider`. Same return shape as `useSorobanResurrectContext()`
(minus `config`), plus `resurrect: SorobanResurrect` (non-null).

```tsx
import { useSorobanResurrect } from '@soroban-resurrect/react-hook'

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrect({
    config: { rpcUrl: 'https://soroban-testnet.stellar.org' },
  })
  // ...
}
```

> Both `SorobanResurrectProvider` and `useSorobanResurrect` re-instantiate
> the underlying `SorobanResurrect` (and reset state to `idle`) whenever
> the `config` object changes by value.
