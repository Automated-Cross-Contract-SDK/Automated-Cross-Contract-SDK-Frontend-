# Types

All types below are exported from `@soroban-resurrect/sdk`.

## `SorobanResurrectConfig`

Configuration options for creating a `SorobanResurrect` instance.

This is the canonical reference for `SorobanResurrectConfig` — every field below is
cross-checked against [`types.ts`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/blob/main/packages/sdk/src/types.ts).
Other documents (`README.md`, `docs/API.md`, `ARCHITECTURE.md`) link back here instead
of maintaining their own copy of the field list.

```typescript
interface SorobanResurrectConfig {
  rpcUrl: string
  networkPassphrase?: string // default: resolved from rpcUrl, else Testnet
  pollIntervalMs?: number // default: 1000
  pollTimeoutMs?: number // default: 60000
  restoreFeeMultiplier?: number // default: 3 — see "Choosing restoreFeeMultiplier" below
  archiveDetectionMethod?: 'simulation' | 'direct' // default: 'simulation'
  archiveDetectionChunkSize?: number // default: 50
  archiveDetectionConcurrency?: number // default: 4
}
```

| Field                     | Description                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| `rpcUrl`                   | URL of the Soroban RPC endpoint.                                               |
| `networkPassphrase`        | Network passphrase (defaults to Testnet).                                      |
| `pollIntervalMs`           | Polling interval in ms when waiting for transaction confirmation.              |
| `pollTimeoutMs`             | Timeout in ms when waiting for transaction confirmation.                       |
| `restoreFeeMultiplier`     | Multiplier applied to `minResourceFee` when building a restore transaction.    |
| `archiveDetectionMethod`   | Method for detecting archived keys: `'simulation'` (default) or `'direct'`.    |
| `archiveDetectionChunkSize` | Ledger keys per `getLedgerEntries` request during `'direct'` detection.       |
| `archiveDetectionConcurrency` | Chunk requests kept in flight at once during `'direct'` detection.          |

## `SorobanResurrectNetwork`

Describes a Soroban network: its RPC endpoint and passphrase. Use the preset
helpers below instead of hand-writing passphrases — they keep the RPC URL and
passphrase in sync and are the values `switchNetwork()` accepts.

```typescript
interface SorobanResurrectNetwork {
  rpcUrl: string
  networkPassphrase: string
}

const SorobanResurrectNetwork = {
  create(rpcUrl: string, networkPassphrase: string): SorobanResurrectNetwork,
  testnet(): SorobanResurrectNetwork,
  mainnet(): SorobanResurrectNetwork,
  futurenet(): SorobanResurrectNetwork,
  custom(rpcUrl: string, networkPassphrase: string): SorobanResurrectNetwork,
}
```

| Helper                          | RPC URL                              | Passphrase                          |
| ------------------------------- | ------------------------------------ | ----------------------------------- |
| `SorobanResurrectNetwork.testnet()`   | `https://soroban-testnet.stellar.org` | `Test SDF Network ; September 2015` |
| `SorobanResurrectNetwork.mainnet()`   | `https://soroban-mainnet.stellar.org` | `Public Global Stellar Network ; September 2015` |
| `SorobanResurrectNetwork.futurenet()` | `https://rpc-futurenet.stellar.org`   | `Test SDF Future Network ; October 2022` |
| `SorobanResurrectNetwork.create(rpcUrl, passphrase)` | caller-supplied | caller-supplied |
| `SorobanResurrectNetwork.custom(rpcUrl, passphrase)` | caller-supplied | caller-supplied |

`create()` and `custom()` are equivalent — both build a network from an explicit
RPC URL and passphrase. Use `custom()` when pointing at a local or third-party
RPC; use `create()` when you already have both values in hand.

> **Futurenet caveat:** Futurenet's passphrase (`Test SDF Future Network ; October 2022`)
is **not** interchangeable with Testnet's. Signing a Futurenet transaction with the
Testnet passphrase (or vice versa) produces an invalid signature. Always take the
passphrase from the preset rather than hard-coding it.

## `NetworkChangedEvent`

Payload emitted on the `networkChanged` event after a successful
[`switchNetwork()`](/api/sdk#switchnetwork) call.

```typescript
interface NetworkChangedEvent {
  previous: SorobanResurrectNetwork
  current: SorobanResurrectNetwork
}
```

| Field      | Description                                              |
| ---------- | -------------------------------------------------------- |
| `previous` | The network the instance was on before the switch.       |
| `current`  | The network the instance is now on.                      |

### What survives a switch

`switchNetwork()` swaps the RPC endpoint and passphrase in place. It does **not**
recreate the instance, so anything bound to the instance keeps working:

| Concern            | After `switchNetwork()`                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| Event listeners    | **Preserved.** `on('networkChanged', …)` and other subscriptions stay attached.          |
| Restore history    | **Preserved.** Previously recorded restore results remain readable.                      |
| TTL watchers       | **Preserved.** Active watchers keep running and now poll the new network.                |
| Archive cache      | **Reset.** Cached archive-detection results are cleared — ledger keys differ per network.|
| In-flight workflow | **Not migrated.** A submit/restore already running finishes against the old network.     |

## `WalletAdapter`

Wallet interface that wraps browser or extension wallets (e.g. Freighter).

```typescript
interface WalletAdapter {
  isConnected(): Promise<boolean>
  getPublicKey(): Promise<string>
  signTransaction(
    tx: string,
    opts?: { networkPassphrase?: string; network?: string },
  ): Promise<string>
}
```

## `ArchivedLedgerEntry`

Represents a single ledger entry that has been archived (expired TTL).

```typescript
interface ArchivedLedgerEntry {
  key: xdr.LedgerKey
  keyBase64: string
}
```

## `SimulateResponse`

Convenience alias for the Soroban RPC simulate response type.

```typescript
type SimulateResponse = rpc.Api.SimulateTransactionResponse
```

## `ResurrectResult`

Result returned from the restore-and-submit workflow.

```typescript
interface ResurrectResult {
  success: boolean
  originalTxHash?: string
  restoreTxHash?: string
  archivedKeysDetected: number
  error?: string
}
```

## `SubmitWithRestoreOptions`

Options for submitting a transaction with automatic archive restoration.

```typescript
interface SubmitWithRestoreOptions {
  transaction: Transaction
  wallet: WalletAdapter
  onSigningRestore?: () => void
  onSubmittingRestore?: () => void
  onSigningOriginal?: () => void
  onRestoreNeeded?: (archivedKeys: ArchivedLedgerEntry[]) => void
  onRestoreSubmitted?: (txHash: string) => void
  onRestoreConfirmed?: (txHash: string) => void
  onOriginalSubmitted?: (txHash: string) => void
  onRestoreFailed?: (error: string) => void
}
```

| Callback              | Fires when...                                                           |
| --------------------- | ----------------------------------------------------------------------- |
| `onRestoreNeeded`     | Archived entries are detected and restoration is required.              |
| `onSigningRestore`    | Restore transaction is ready to be signed.                              |
| `onSubmittingRestore` | Restore transaction is signed and about to be submitted.                |
| `onRestoreSubmitted`  | The restore transaction has been submitted.                             |
| `onRestoreConfirmed`  | The restore transaction is confirmed on-chain.                          |
| `onSigningOriginal`   | The restore step (if any) is done and the original tx is ready to sign. |
| `onOriginalSubmitted` | The original transaction has been submitted.                            |
| `onRestoreFailed`     | The restore step of the workflow fails.                                 |

## `RestoreState`

Tracks the current stage of the restore-and-submit workflow.

```typescript
type RestoreState =
  | 'idle'
  | 'simulating'
  | 'restore_needed'
  | 'signing_restore'
  | 'submitting_restore'
  | 'confirming_restore'
  | 'signing_original'
  | 'submitting_original'
  | 'success'
  | 'error'
  // Proactive / estimation states (additive, non-submit)
  | 'estimating'
  | 'watching_ttl'
  | 'extending_ttl'
```

The last three are **additive** — they model long-running activity outside
the reactive submit flow (fee estimation and proactive TTL
watch-and-extend). Existing consumers keep working unchanged.
`isProcessingState()` returns `true` for `estimating` and `extending_ttl`
(active work) and `false` for `watching_ttl` (a passive background poll,
like `idle`); its result for every pre-existing state is unchanged.

## `RestoreStateInfo`

Snapshot of the current workflow state, including message and optional error.

```typescript
interface RestoreStateInfo {
  state: RestoreState
  message: string
  archivedKeys?: ArchivedLedgerEntry[]
  error?: string
}
```

## `Logger`

Structured logging sink supplied via [`SorobanResurrectConfig.logger`](#sorobanresurrectconfig).
Silent by default — see the [Observability section](/api/sdk#observability-injectable-logger-rpc-timings).

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogContext = Record<string, unknown>

interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
}
```

## `RpcTimingEvent`

Emitted via `logger.debug` once per RPC round-trip.

```typescript
interface RpcTimingEvent {
  method: string // the ISorobanRpcClient method called
  durationMs: number // wall-clock duration
  ok: boolean // resolved (true) or rejected (false)
  requestId?: string // correlation id of the enclosing workflow
  error?: string // message when ok === false
}
```

## `ResurrectErrorCode`

Machine-readable error contract for the SDK. Branch on `errorCode` rather than
matching on human-readable messages — messages may change between releases, codes
will not. See the [Error Reference](/api/errors) for the full list of codes with
causes and recommended recovery.

```typescript
type ResurrectErrorCode =
  | 'WALLET_NOT_CONNECTED'
  | 'WALLET_REJECTED'
  | 'SIMULATION_FAILED'
  | 'ARCHIVE_DETECTION_FAILED'
  | 'RESTORE_TX_FAILED'
  | 'RESTORE_TX_TIMEOUT'
  | 'ORIGINAL_TX_FAILED'
  | 'ORIGINAL_TX_TIMEOUT'
  | 'INVALID_CONFIG'
  | 'UNKNOWN_ERROR'
```

### `ResurrectError` vs the `ResurrectResult` error path

Failures surface through two distinct paths, and they are not interchangeable:

- **`ResurrectError`** — thrown for failures that abort the workflow before a
  result can be produced (bad configuration, wallet not connected, wallet
  rejection, simulation failure). Catch these with `try`/`catch` and read
  `err.code` (a `ResurrectErrorCode`).
- **`ResurrectResult.error`** — returned (not thrown) when the workflow runs to
  completion but the restore or original transaction fails or times out. The
  result is still resolved with `success: false`; read `result.error` for the
  message and `result.errorCode` for the machine-readable code