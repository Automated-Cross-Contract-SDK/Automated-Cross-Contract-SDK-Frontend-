# SDK API Reference (`@soroban-resurrect/sdk`)

## `SorobanResurrect`

Main facade for the SDK. Provides a high-level API for detecting archived ledger entries, building restore transactions, and submitting transactions with automatic archive restoration. State changes are published to registered listeners via the observer pattern.

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })
```

### Constructor

```typescript
constructor(config: SorobanResurrectConfig)
```

See [`SorobanResurrectConfig`](/api/types#sorobanresurrectconfig) for all options and their defaults.

### Properties

| Property    | Type                              | Description                                          |
| ----------- | --------------------------------- | ----------------------------------------------------- |
| `server`    | `rpc.Server`                      | The underlying Soroban RPC server instance.           |
| `config`    | `Required<SorobanResurrectConfig>`| Resolved configuration with all defaults applied.     |
| `state`     | `RestoreState`                    | Current workflow state (getter).                      |
| `stateInfo` | `RestoreStateInfo`                | State + message + archived keys + error (getter).     |

### Methods

#### `simulate(transaction)`

```typescript
simulate(transaction: Transaction): Promise<SimulateResponse>
```

Simulates a transaction on the Soroban RPC endpoint. Updates internal state to `'simulating'`.

#### `detectArchivedKeys(transaction)`

```typescript
detectArchivedKeys(transaction: Transaction): Promise<ArchivedLedgerEntry[]>
```

Detects archived ledger entries using the configured `archiveDetectionMethod` (`'simulation'` by default, or `'direct'`). Returns an empty array if none are found or detection fails.

#### `needsRestore(transaction)`

```typescript
needsRestore(transaction: Transaction): Promise<boolean>
```

Convenience wrapper around `detectArchivedKeys` — returns `true` if the transaction requires restoration before it can be submitted.

#### `buildRestoreTx(sourcePublicKey, transaction, simulationResponse?)`

```typescript
buildRestoreTx(
  sourcePublicKey: string,
  transaction: Transaction,
  simulationResponse?: rpc.Api.SimulateTransactionRestoreResponse,
): Promise<Transaction>
```

Builds a restore transaction for the given source account and transaction. If `simulationResponse` is omitted, the transaction is simulated first (updating state to `'simulating'`). Throws if the simulation does not indicate a restore is needed.

#### `submitWithRestore(options)`

```typescript
submitWithRestore(options: SubmitWithRestoreOptions): Promise<ResurrectResult>
```

Submits a transaction with automatic archive restoration. If the simulation detects archived entries, a restore transaction is built, signed, submitted, and confirmed before the original transaction is rebuilt and submitted. State transitions are published to all registered listeners throughout. See [`SubmitWithRestoreOptions`](/api/types#submitwithrestoreoptions) for the full set of lifecycle callbacks.

#### `onStateChange(listener)`

```typescript
onStateChange(listener: (info: RestoreStateInfo) => void): () => void
```

Registers a listener for state changes. Returns an unsubscribe function.

#### `reset()`

```typescript
reset(): void
```

Resets the instance back to `'idle'` state, clearing any archived keys and error messages from previous workflows.

## Standalone Functions

These are exported alongside the class for advanced/lower-level usage:

| Export                          | Module        | Description                                                                 |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `executeWithRestore(params)`     | `Executor.js` | Runs the full restore-and-submit workflow used internally by `submitWithRestore`. |
| `isRestoreResponse(response)`    | `Archiver.js` | Type guard for a restore-required simulation response.                        |
| `isSuccessResponse(response)`    | `Archiver.js` | Type guard for a successful simulation response.                              |
| `isErrorResponse(response)`      | `Archiver.js` | Type guard for an error simulation response.                                  |
| `extractArchivedKeys(response)`  | `Archiver.js` | Extracts archived ledger keys from a restore simulation response.             |
| `extractFootprintFromSuccess(response)` | `Archiver.js` | Extracts read-only/read-write ledger keys from a success simulation footprint. |
| `detectArchivedEntries(server, keys)` | `Archiver.js` | Queries the RPC server directly to find which ledger keys are archived.  |
| `detectArchivedKeysViaSimulation(server, tx)` | `Archiver.js` | Detects archived keys via the simulation-restore-response approach. |
| `detectArchivedKeysViaDirect(server, tx)` | `Archiver.js` | Detects archived keys by querying the ledger directly.               |
| `buildRestoreTransaction(params)` | `Restorer.js` | Builds a restore transaction from simulation data.                            |
| `buildOriginalAfterRestore(server, tx, networkPassphrase, fee)` | `Restorer.js` | Rebuilds the original transaction after a successful restore.  |
| `waitForTransaction(server, hash, pollIntervalMs?, pollTimeoutMs?)` | `Restorer.js` | Polls until a transaction reaches a terminal status.       |
| `prepareTransaction(server, tx)` | `Restorer.js` | Simulates and assembles a transaction; throws on error or restore-required. |
| `extractXdrOperations(tx)`       | `Restorer.js` | Extracts XDR operations from a transaction, handling fee-bump envelopes.       |

For the full type definitions used throughout this API, see [Types](/api/types).
