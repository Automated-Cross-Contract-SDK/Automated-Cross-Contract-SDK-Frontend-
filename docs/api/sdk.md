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

| Property    | Type                               | Description                                       |
| ----------- | ---------------------------------- | ------------------------------------------------- |
| `server`    | `rpc.Server`                       | The underlying Soroban RPC server instance.       |
| `config`    | `Required<SorobanResurrectConfig>` | Resolved configuration with all defaults applied. |
| `state`     | `RestoreState`                     | Current workflow state (getter).                  |
| `stateInfo` | `RestoreStateInfo`                 | State + message + archived keys + error (getter). |

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

| Export                                                              | Module        | Description                                                                       |
| ------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------- |
| `executeWithRestore(params)`                                        | `Executor.js` | Runs the full restore-and-submit workflow used internally by `submitWithRestore`. |
| `isRestoreResponse(response)`                                       | `Archiver.js` | Type guard for a restore-required simulation response.                            |
| `isSuccessResponse(response)`                                       | `Archiver.js` | Type guard for a successful simulation response.                                  |
| `isErrorResponse(response)`                                         | `Archiver.js` | Type guard for an error simulation response.                                      |
| `extractArchivedKeys(response)`                                     | `Archiver.js` | Extracts archived ledger keys from a restore simulation response.                 |
| `extractFootprintFromSuccess(response)`                             | `Archiver.js` | Extracts read-only/read-write ledger keys from a success simulation footprint.    |
| `detectArchivedEntries(server, keys)`                               | `Archiver.js` | Queries the RPC server directly to find which ledger keys are archived.           |
| `detectArchivedKeysViaSimulation(server, tx)`                       | `Archiver.js` | Detects archived keys via the simulation-restore-response approach.               |
| `detectArchivedKeysViaDirect(server, tx)`                           | `Archiver.js` | Detects archived keys by querying the ledger directly.                            |
| `buildRestoreTransaction(params)`                                   | `Restorer.js` | Builds a restore transaction from simulation data.                                |
| `buildOriginalAfterRestore(server, tx, networkPassphrase, fee)`     | `Restorer.js` | Rebuilds the original transaction after a successful restore.                     |
| `waitForTransaction(server, hash, pollIntervalMs?, pollTimeoutMs?)` | `Restorer.js` | Polls until a transaction reaches a terminal status.                              |
| `prepareTransaction(server, tx)`                                    | `Restorer.js` | Simulates and assembles a transaction; throws on error or restore-required.       |
| `extractXdrOperations(tx)`                                          | `Restorer.js` | Extracts XDR operations from a transaction, handling fee-bump envelopes.          |

## Observability — injectable logger + RPC timings

The SDK is **silent by default** (zero overhead — no strings built, no calls
made). Pass `config.logger` to receive structured log lines for state
transitions, RPC calls (with wall-clock duration), and the restore steps.
Each `submitWithRestore` call is tagged with a `requestId` so lines from
concurrent workflows can be correlated.

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  logger: {
    debug: (msg, ctx) => console.debug('[soroban-resurrect]', msg, ctx ?? ''),
    info: (msg, ctx) => console.info('[soroban-resurrect]', msg, ctx ?? ''),
    warn: (msg, ctx) => console.warn('[soroban-resurrect]', msg, ctx ?? ''),
    error: (msg, ctx) => console.error('[soroban-resurrect]', msg, ctx ?? ''),
  },
})

// → debug "rpc simulateTransaction ok (48.2ms)" { method, durationMs, ok, requestId }
// → debug "state → simulating"                   { requestId, state, message }
// → info  "submitWithRestore: finished"          { requestId, success: true, ... }
```

| Export                       | Description                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `NOOP_LOGGER`                | Shared silent sink. `sr.logger` resolves to this when no `logger` is configured.     |
| `resolveLogger(l?)`          | Returns `l` or `NOOP_LOGGER`.                                                        |
| `isLoggingEnabled(l?)`       | `true` when `l` will actually emit — use it to guard expensive context construction. |
| `createRequestId()`          | Short process-unique correlation id (`req_<rand>_<n>`).                              |
| `LoggingRpcClient`           | `ISorobanRpcClient` decorator that times every call and emits an `RpcTimingEvent`.   |
| `withRpcLogging(c,l,getId?)` | Wraps `c` when `l` is active; returns `c` untouched otherwise.                       |

See [`Logger`](/api/types#logger) and [`RpcTimingEvent`](/api/types#rpctimingevent).

## Account / contract-level archived-entry scan

Answer "which of this contract's data entries are archived or expiring
soon?" **without building a transaction** (`detectArchivedKeys` requires
one).

```typescript
import { getExpiringEntriesForContract, getExpiringEntriesForAccount } from '@soroban-resurrect/sdk'
import { nativeToScVal, Asset } from '@stellar/stellar-sdk'

const { entries, expiringSoon, archived } = await getExpiringEntriesForContract(
  sr.server,
  'CONTRACT_ID', // contract id (StrKey CONTRACT_ID)
  { storageKeys: [nativeToScVal('config')], expiringWithinLedgers: 17_280 },
)

const acct = await getExpiringEntriesForAccount(sr.server, 'ACCOUNT_ID', {
  trustlineAssets: [new Asset('USDC', 'ISSUER_PUBKEY')],
})
```

| Export                                                     | Description                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `getExpiringEntriesForContract(server, contractId, opts?)` | Scans instance + Wasm code + supplied storage keys; returns TTL info, `expiringSoon`, and `archived`. Chunks large key sets (50 per RPC call). |
| `getExpiringEntriesForAccount(server, accountId, opts?)`   | Presence scan of the account entry + its trustlines.                                                                                           |
| `DEFAULT_EXPIRING_SOON_LEDGERS`                            | `17280` (~24 h) — default `expiringWithinLedgers`.                                                                                             |

## Multisig restore (`MultiSigWalletAdapter`)

Wraps N `WalletAdapter`s, collects signatures (parallel by default),
merges them into one envelope, and enforces a weighted `threshold` before
returning — so an under-signed restore tx never reaches `sendTransaction`.
Implements `WalletAdapter`, so it drops straight into `submitWithRestore({ wallet })`.

```typescript
import { MultiSigWalletAdapter } from '@soroban-resurrect/sdk'
import { Networks } from '@stellar/stellar-sdk'

const treasury = new MultiSigWalletAdapter({
  signers: [{ adapter: walletA }, { adapter: walletB }, { adapter: walletC }],
  threshold: 2, // 2-of-3
  networkPassphrase: Networks.PUBLIC,
  parallel: true, // default
})

await sr.submitWithRestore({ transaction, wallet: treasury })
```

| Member                              | Description                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `signTransaction(xdr, opts?)`       | Collects + merges signatures; **throws** if weight `< threshold`.                          |
| `collectSignatures(xdr, opts?)`     | Same, without enforcing the threshold — inspect `weight` / `signerCount` / `thresholdMet`. |
| `verifyThreshold(signedXdr, opts?)` | Pre-submit guard: re-checks a signed envelope against the signer set + threshold.          |
| `threshold` / `maxWeight`           | Getters for the required and maximum attainable signing weight.                            |

For the full type definitions used throughout this API, see [Types](/api/types).
