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

See [`SorobanResurrectConfig`](/api/types#sorobanresurrectconfig) for all options and their defaults — including `rpcClient` for injecting a test double (see [Testing](/guide/testing)).

### Properties

| Property    | Type                              | Description                                          |
| ----------- | --------------------------------- | ----------------------------------------------------- |
| `server`    | `ISorobanRpcClient`               | The RPC client instance — `config.rpcClient` when supplied, otherwise an auto-created `SorobanRpcClient`. See [Testing](/guide/testing). |
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

With `'direct'` detection, a large footprint is split into chunks of `archiveDetectionChunkSize` keys (50 by default) and `archiveDetectionConcurrency` chunk requests (4 by default) are kept in flight at once, so detection cost scales with `ceil(chunks / concurrency)` round trips rather than one per chunk. Raise the concurrency for faster detection, lower it to stay under an endpoint's rate limit — a rate-limited chunk is conservatively reported as archived. Returned entries keep the footprint's key order regardless of which request settles first.

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
| `detectArchivedEntries(server, keys, options?)` | `Archiver.js` | Queries the RPC server directly to find which ledger keys are archived, in parallel chunks. |
| `detectArchivedKeysViaSimulation(server, tx)` | `Archiver.js` | Detects archived keys via the simulation-restore-response approach. |
| `detectArchivedKeysViaDirect(server, tx, options?)` | `Archiver.js` | Detects archived keys by querying the ledger directly.     |
| `buildRestoreTransaction(params)` | `Restorer.js` | Builds a restore transaction from simulation data.                            |
| `buildOriginalAfterRestore(server, tx, networkPassphrase, fee)` | `Restorer.js` | Rebuilds the original transaction after a successful restore.  |
| `waitForTransaction(server, hash, pollIntervalMs?, pollTimeoutMs?)` | `Restorer.js` | Polls until a transaction reaches a terminal status.       |
| `prepareTransaction(server, tx)` | `Restorer.js` | Simulates and assembles a transaction; throws on error or restore-required. |
| `extractXdrOperations(tx)`       | `Restorer.js` | Extracts XDR operations from a transaction, handling fee-bump envelopes.       |
| `createDebugger(namespace)`      | `Debug.js`    | Creates a namespaced debug logger. See [Debug logging](#debug-logging).        |
| `isDebugEnabled(namespace)`      | `Debug.js`    | Returns whether the active `DEBUG` filter enables a namespace.                 |
| `refreshDebugFilter(spec?)`      | `Debug.js`    | Re-reads the filter after `DEBUG` or `localStorage.debug` changes at runtime.  |

## Debug logging

The SDK logs its internal operations through a namespaced debug logger. Nothing
is printed unless logging is switched on explicitly.

In Node, set the `DEBUG` environment variable:

```bash
DEBUG=soroban-resurrect:* node script.js
```

In a browser, set `localStorage.debug` and reload:

```js
localStorage.debug = 'soroban-resurrect:*'
```

### Namespaces

| Namespace | What it logs |
|-----------|--------------|
| `soroban-resurrect:core` | State transitions and archived-key detection on the `SorobanResurrect` instance. |
| `soroban-resurrect:archiver` | Chunked ledger-entry queries and their archived/not-archived outcomes. |
| `soroban-resurrect:executor` | The restore-and-submit workflow. |

Patterns support `*` as a wildcard, comma or space separated, and a leading `-`
to exclude:

```bash
DEBUG=soroban-resurrect:archiver          # one namespace
DEBUG=soroban-resurrect:*,-soroban-resurrect:core   # all but core
```

### Logging from your own code

`createDebugger` is exported, so application code can log under the same filter:

```typescript
import { createDebugger } from '@soroban-resurrect/sdk'

const debug = createDebugger('my-app')

debug('submitting transaction %s', hash)
// soroban-resurrect:my-app submitting transaction abc123 +4ms
```

Guard expensive work with the `enabled` flag:

```typescript
if (debug.enabled) {
  debug('footprint: %o', keys.map((k) => k.keyBase64))
}
```

Output goes to `console.debug`. Note that most browser consoles hide
`console.debug` behind a "Verbose" log level filter.

| `createDebugger(scope)`          | `debug.js`    | Creates a namespaced debug logger for internal SDK operations.                |

## Debug Logging

The SDK logs its internal operations through namespaced loggers that stay silent
unless a filter is set. Namespaces are prefixed with `soroban-resurrect`:
`soroban-resurrect:resurrect` for lifecycle and state transitions, and
`soroban-resurrect:archiver` for archive detection.

In Node, set the `DEBUG` environment variable:

```bash
DEBUG=soroban-resurrect:* node ./scripts/restore.mjs
```

In the browser, set `localStorage.debug` and reload:

```javascript
localStorage.debug = 'soroban-resurrect:*'
```

The filter is a comma or space separated list of patterns. `*` matches any run
of characters and a `-` prefix excludes a namespace:

```bash
DEBUG='soroban-resurrect:*,-soroban-resurrect:archiver' npm run dev:example
```

Filters are read once when the module loads, so change `DEBUG` before starting
the process rather than during it. Output goes to `console.debug`, prefixed with
an ISO timestamp and the namespace.

Application code can create its own loggers under the same filter:

```typescript
import { createDebugger } from '@soroban-resurrect/sdk'

const debug = createDebugger('my-dapp')
debug('submitting transaction %s', tx.hash().toString('hex'))
```

For the full type definitions used throughout this API, see [Types](/api/types).
