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
  - [Types](#types)
- [`@soroban-resurrect/react-hook`](#soroban-resurrectreact-hook)
  - [`SorobanResurrectProvider` / `useSorobanResurrectContext`](#sorobanresurrectprovider--usesorobanresurrectcontext)
  - [`useSorobanResurrect`](#usesorobanresurrect)
- [Testing with an injected RPC client](#testing-with-an-injected-rpc-client)

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

| Member               | Signature                                                                                          | Description                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `server`             | `readonly rpc.Server`                                                                              | The underlying Soroban RPC server instance.                                                                        |
| `config`             | `readonly Required<SorobanResurrectConfig>`                                                        | Resolved configuration with defaults applied.                                                                      |
| `state`              | `get state(): RestoreState`                                                                        | Current workflow state.                                                                                            |
| `stateInfo`          | `get stateInfo(): RestoreStateInfo`                                                                | Snapshot of state, message, archived keys, and error.                                                              |
| `onStateChange`      | `(listener: (info: RestoreStateInfo) => void) => () => void`                                       | Subscribe to state transitions. Returns an unsubscribe function.                                                   |
| `reset`              | `(): void`                                                                                         | Reset back to `idle`, clearing archived keys and errors.                                                           |
| `simulate`           | `(transaction: Transaction) => Promise<SimulateResponse>`                                          | Simulate a transaction; sets state to `simulating`.                                                                |
| `detectArchivedKeys` | `(transaction: Transaction) => Promise<ArchivedLedgerEntry[]>`                                     | Detect archived entries using the configured detection method. Never throws.                                       |
| `needsRestore`       | `(transaction: Transaction) => Promise<boolean>`                                                   | Convenience boolean wrapper around `detectArchivedKeys`.                                                           |
| `buildRestoreTx`     | `(sourcePublicKey: string, transaction: Transaction, simulationResponse?) => Promise<Transaction>` | Build an unsigned restore transaction. **Throws** if no restore is needed.                                         |
| `submitWithRestore`  | `(options: SubmitWithRestoreOptions) => Promise<ResurrectResult>`                                  | Full workflow: detect → restore (if needed) → submit original. Never throws — failures are returned in the result. |

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

| Function                                               | Description                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `isRestoreResponse(response)`                          | Type guard: does the simulation response require a restore?                                                                      |
| `isSuccessResponse(response)`                          | Type guard: did the simulation succeed with no restore needed?                                                                   |
| `isErrorResponse(response)`                            | Type guard: did the simulation fail?                                                                                             |
| `extractArchivedKeys(response)`                        | Extract archived ledger keys from a restore response's footprint.                                                                |
| `extractFootprintFromSuccess(response)`                | Extract `{ readOnly, readWrite }` keys from a success response's footprint.                                                      |
| `detectArchivedEntries(server, ledgerKeys)`            | Query the ledger directly to find which of the given keys are archived. Errors per-chunk are treated conservatively as archived. |
| `detectArchivedKeysViaSimulation(server, transaction)` | Simulation-based detection strategy (default).                                                                                   |
| `detectArchivedKeysViaDirect(server, transaction)`     | Direct-ledger-query detection strategy. **Throws** if simulation fails or already indicates a restore is needed.                 |

### Restorer functions

Source: [`Restorer.ts`](../packages/sdk/src/Restorer.ts)

| Function                                                                | Description                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `buildRestoreTransaction(params)`                                       | Build an unsigned `restoreFootprint` transaction. Fee = `minResourceFee * restoreFeeMultiplier`.                                                 |
| `waitForTransaction(server, hash, pollIntervalMs?, pollTimeoutMs?)`     | Poll until a transaction reaches `SUCCESS`/`FAILED`, with exponential backoff + jitter. **Throws** on timeout.                                   |
| `extractXdrOperations(tx)`                                              | Extract raw XDR operations from a transaction, handling fee-bump envelopes.                                                                      |
| `buildOriginalAfterRestore(server, originalTx, networkPassphrase, fee)` | Rebuild the original transaction after a successful restore (fresh sequence number + re-simulation). **Throws** if restoration was insufficient. |
| `prepareTransaction(server, tx)`                                        | Simulate and assemble a transaction in one step. **Throws** on simulation error or if a restore is required.                                     |

### Types

Source: [`types.ts`](../packages/sdk/src/types.ts)

- `SorobanResurrectConfig` — constructor options (`rpcUrl`, `networkPassphrase?`, `pollIntervalMs?`, `pollTimeoutMs?`, `restoreFeeMultiplier?`, `archiveDetectionMethod?`).
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

| Field                | Type                                       | Description                                 |
| -------------------- | ------------------------------------------ | ------------------------------------------- |
| `resurrect`          | `SorobanResurrect \| null`                 | Underlying SDK instance.                    |
| `config`             | `SorobanResurrectConfig`                   | Config passed to the provider.              |
| `state`              | `RestoreStateInfo`                         | Current workflow state snapshot.            |
| `isProcessing`       | `boolean`                                  | `true` while a restore/submit is in flight. |
| `submitWithRestore`  | `(tx, wallet) => Promise<ResurrectResult>` | Bound convenience wrapper.                  |
| `detectArchivedKeys` | `(tx) => Promise<ArchivedLedgerEntry[]>`   | Bound convenience wrapper.                  |
| `reset`              | `() => void`                               | Reset state back to `idle`.                 |

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

---

## Testing with an injected RPC client

Source: [`RpcClient.ts`](../packages/sdk/src/RpcClient.ts)

`SorobanResurrect.server` is `public readonly` and every internal caller
(`SorobanResurrectExecutor`, `SorobanResurrectSimulator`) captures its own
private reference to it at construction time — so **reassigning `sdk.server`
after construction does nothing**, both because TypeScript's `readonly`
rejects the assignment and because the internals wouldn't see it even if it
compiled. The supported way to drive a deterministic workflow in a test is
`config.rpcClient`, passed at construction: implement
{@link ISorobanRpcClient} (six methods: `simulateTransaction`,
`sendTransaction`, `getTransaction`, `getAccount`, `getLedgerEntries`,
`getLatestLedger`) and the SDK uses it for every RPC call instead of
constructing its own `rpc.Server` from `rpcUrl`.

```typescript
import { SorobanResurrect, type ISorobanRpcClient } from '@soroban-resurrect/sdk'

// A minimal test double. TypeScript enforces every method is present —
// omitting one is a compile error, not a runtime surprise partway through a test.
const rpcClient: ISorobanRpcClient = {
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getAccount: vi.fn(),
  getLedgerEntries: vi.fn(),
  getLatestLedger: vi.fn(),
}

const resurrect = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org', // still required; unused when rpcClient is set
  rpcClient,
})
```

### Restore-then-submit happy path

Drive the full `submitWithRestore` workflow deterministically by scripting
`simulateTransaction` to first report a restore is needed, then succeed on
the rebuilt original transaction:

```typescript
const simulateTransaction = vi
  .fn()
  // 1st call: original tx simulation reports archived entries
  .mockResolvedValueOnce(restoreNeededResponse)
  // 2nd call: re-simulation of the rebuilt original tx succeeds
  .mockResolvedValueOnce(successResponse)

const rpcClient: ISorobanRpcClient = {
  simulateTransaction,
  sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: 'abc' }),
  getTransaction: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
  getAccount: vi.fn().mockResolvedValue(new Account(publicKey, '1')),
  getLedgerEntries: vi.fn(),
  getLatestLedger: vi.fn(),
}

const resurrect = new SorobanResurrect({ rpcUrl: 'https://…', rpcClient })
const result = await resurrect.submitWithRestore({ transaction: tx, wallet })

expect(result.success).toBe(true)
expect(result.restoreTxHash).toBeDefined()
expect(simulateTransaction).toHaveBeenCalledTimes(2)
```

The same `rpcClient` object is reused by `queryLedgerTTL`, `getExpiringSoonEntries`,
`sendTransaction`, and every other SDK method that talks to the network — one
injected client is enough to control an entire test.
