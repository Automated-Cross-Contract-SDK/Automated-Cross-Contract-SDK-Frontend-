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

| Member               | Signature                                                                                               | Description                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`             | `readonly ISorobanRpcClient`                                                                            | The underlying Soroban RPC client (either an injected `config.rpcClient` or a `SorobanRpcClient` wrapping `rpc.Server`).                                                                                                                                                                        |
| `config`             | `readonly ResolvedSorobanResurrectConfig`                                                               | Resolved configuration with defaults applied.                                                                                                                                                                                                                                                   |
| `state`              | `get state(): RestoreState`                                                                             | Current workflow state.                                                                                                                                                                                                                                                                         |
| `stateInfo`          | `get stateInfo(): RestoreStateInfo`                                                                     | Snapshot of state, message, archived keys, and error.                                                                                                                                                                                                                                           |
| `onStateChange`      | `(listener: (info: RestoreStateInfo) => void) => () => void`                                            | Subscribe to state transitions. Returns an unsubscribe function.                                                                                                                                                                                                                                |
| `reset`              | `(): void`                                                                                              | Reset back to `idle`, clearing archived keys and errors.                                                                                                                                                                                                                                        |
| `simulate`           | `(transaction: Transaction) => Promise<SimulateResponse>`                                               | Simulate a transaction; sets state to `simulating`.                                                                                                                                                                                                                                             |
| `detectArchivedKeys` | `(transaction: Transaction) => Promise<ArchivedLedgerEntry[]>`                                          | Detect archived entries using the configured detection method. Never throws.                                                                                                                                                                                                                    |
| `needsRestore`       | `(transaction: Transaction) => Promise<boolean>`                                                        | Convenience boolean wrapper around `detectArchivedKeys`.                                                                                                                                                                                                                                        |
| `buildRestoreTx`     | `(sourcePublicKey: string, transaction: Transaction, simulationResponse?) => Promise<Transaction>`      | Build an unsigned restore transaction. **Throws** if no restore is needed, or if `RestoreFeeCapExceededError` — see `maxRestoreFeeStroops`.                                                                                                                                                     |
| `restoreKeys`        | `(keys: xdr.LedgerKey[], wallet: WalletAdapter, opts?: RestoreKeysOptions) => Promise<ResurrectResult>` | Restore an arbitrary list of ledger keys directly — no source transaction or prior simulation required. Prices the restore itself, signs, submits, and polls to confirmation. Never throws.                                                                                                     |
| `submitWithRestore`  | `(options: SubmitWithRestoreOptions) => Promise<ResurrectResult>`                                       | Full workflow: detect → restore (if needed) → submit original. Never throws — failures are returned in the result. Automatically rebuilds and resubmits the original transaction (up to `config.maxSequenceRetries`) if it's rejected with `tx_bad_seq`; see `ResurrectResult.sequenceRetries`. |

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

`restoreKeys` skips the source-transaction step entirely — useful for
proactive maintenance (e.g. restoring a contract's storage ahead of an
upgrade):

```ts
import { buildContractDataKey, buildContractCodeKey } from '@soroban-resurrect/sdk'

const result = await resurrect.restoreKeys(
  [buildContractDataKey(contractId, key), buildContractCodeKey(wasmHash)],
  wallet,
)
if (result.success) console.log('Restored:', result.restoreTxHash)
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

| Function                                                                                     | Description                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isRestoreResponse(response)`                                                                | Type guard: does the simulation response require a restore?                                                                                          |
| `isSuccessResponse(response)`                                                                | Type guard: did the simulation succeed with no restore needed?                                                                                       |
| `isErrorResponse(response)`                                                                  | Type guard: did the simulation fail?                                                                                                                 |
| `extractArchivedKeys(response)`                                                              | Extract archived ledger keys from a restore response's footprint.                                                                                    |
| `extractFootprintFromSuccess(response)`                                                      | Extract `{ readOnly, readWrite }` keys from a success response's footprint.                                                                          |
| `detectArchivedEntries(server, ledgerKeys)`                                                  | Query the ledger directly to find which of the given keys are archived. Errors per-chunk are treated conservatively as archived.                     |
| `detectArchivedKeysViaSimulation(server, transaction)`                                       | Simulation-based detection strategy (default).                                                                                                       |
| `detectArchivedKeysViaDirect(server, transaction)`                                           | Direct-ledger-query detection strategy. **Throws** if simulation fails or already indicates a restore is needed.                                     |
| `buildContractDataKey(contractId, key, keyType?)`                                            | Build a `ContractData` ledger key for a given contract ID and storage key.                                                                           |
| `checkArchivedContractData(server, contractId, key, keyType?)` / `getContractDataEntry(...)` | Check/fetch a single contract storage entry without simulating a full transaction.                                                                   |
| `buildContractCodeKey(wasmHash)`                                                             | Build a `ContractCode` (wasm) ledger key from a wasm hash — deployed contract bytecode expires and can be restored the same way as contract storage. |
| `checkArchivedContractCode(server, wasmHash)` / `getContractCodeEntry(server, wasmHash)`     | Check/fetch a contract's wasm entry, e.g. before an upgrade or deployment that references an existing wasm hash.                                     |

### Restorer functions

Source: [`Restorer.ts`](../packages/sdk/src/Restorer.ts)

| Function                                                                | Description                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildRestoreTransaction(params)`                                       | Build an unsigned `restoreFootprint` transaction. Fee = `minResourceFee * restoreFeeMultiplier`. **Throws** `RestoreFeeCapExceededError` if that fee exceeds `config.maxRestoreFeeStroops`.                                                                                 |
| `buildRestoreTransactionFromKeys(params)`                               | Build an unsigned `restoreFootprint` transaction for an arbitrary list of ledger keys, with no source transaction or footprint required — prices the restore via a throwaway simulation, then delegates to `buildRestoreTransaction`. Backs `SorobanResurrect.restoreKeys`. |
| `waitForTransaction(server, hash, pollIntervalMs?, pollTimeoutMs?)`     | Poll until a transaction reaches `SUCCESS`/`FAILED`, with exponential backoff + jitter. **Throws** on timeout.                                                                                                                                                              |
| `extractXdrOperations(tx)`                                              | Extract raw XDR operations from a transaction, handling fee-bump envelopes.                                                                                                                                                                                                 |
| `buildOriginalAfterRestore(server, originalTx, networkPassphrase, fee)` | Rebuild the original transaction after a successful restore (fresh sequence number + re-simulation). **Throws** if restoration was insufficient.                                                                                                                            |
| `prepareTransaction(server, tx)`                                        | Simulate and assemble a transaction in one step. **Throws** on simulation error or if a restore is required.                                                                                                                                                                |
| `isTxBadSeqError(sendResponse)`                                         | Type guard: was a `sendTransaction` response rejected specifically because of `tx_bad_seq`? Used by `executeWithRestore` to decide whether to rebuild-and-retry the original transaction.                                                                                   |

### Types

Source: [`types.ts`](../packages/sdk/src/types.ts)

- `SorobanResurrectConfig` — constructor options (`rpcUrl`, `networkPassphrase?`, `pollIntervalMs?`, `pollTimeoutMs?`, `restoreFeeMultiplier?`, `archiveDetectionMethod?`, `rpcClient?`, `maxRestoreFeeStroops?`, `maxSequenceRetries?`).
- `WalletAdapter` — `isConnected()`, `getPublicKey()`, `signTransaction(xdr, opts?)`.
- `ArchivedLedgerEntry` — `{ key: xdr.LedgerKey, keyBase64: string }`.
- `SimulateResponse` — alias for `rpc.Api.SimulateTransactionResponse`.
- `ResurrectResult` — `{ success, originalTxHash?, restoreTxHash?, archivedKeysDetected, error?, sequenceRetries? }`. `sequenceRetries` counts `tx_bad_seq` rebuild-and-resubmit attempts for the original transaction (only present when a restore occurred).
- `SubmitWithRestoreOptions` — `{ transaction, wallet, ...lifecycle callbacks }`.
- `RestoreKeysOptions` — `{ onSigningRestore?, onSubmittingRestore?, onRestoreSubmitted?, onRestoreConfirmed? }`, passed to `SorobanResurrect.restoreKeys`.
- `RestoreState` — the workflow's state machine states (see `ARCHITECTURE.md` for the diagram).
- `RestoreStateInfo` — `{ state, message, archivedKeys?, error? }`.
- `RestoreFeeCapExceededError` — thrown by `buildRestoreTransaction`/`restoreKeys` when the computed fee exceeds `maxRestoreFeeStroops`; carries `computedFeeStroops` and `capFeeStroops`.
- `LedgerEntryTTLInfo` (from `TTLHelpers.ts`) — now includes `entryType: 'contractData' | 'contractCode' | 'other'`, so `queryLedgerTTL`/`getExpiringSoonEntries` results distinguish wasm (contract-code) entries from contract storage entries.
- `ISorobanRpcClient` (from `RpcClient.ts`) — minimal RPC interface for dependency injection / test doubles; pass a custom implementation via `SorobanResurrectConfig.rpcClient`.

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
