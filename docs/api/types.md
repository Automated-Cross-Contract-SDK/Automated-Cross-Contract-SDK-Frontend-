# Types

All types below are exported from `@soroban-resurrect/sdk`.

## `SorobanResurrectConfig`

Configuration options for creating a `SorobanResurrect` instance.

```typescript
interface SorobanResurrectConfig {
  rpcUrl: string
  networkPassphrase?: string // default: Testnet
  pollIntervalMs?: number // default: 1000
  pollTimeoutMs?: number // default: 60000
  restoreFeeMultiplier?: number // default: 100
  archiveDetectionMethod?: 'simulation' | 'direct' // default: 'simulation'
}
```

| Field                    | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| `rpcUrl`                 | URL of the Soroban RPC endpoint.                                            |
| `networkPassphrase`      | Network passphrase (defaults to Testnet).                                   |
| `pollIntervalMs`         | Polling interval in ms when waiting for transaction confirmation.           |
| `pollTimeoutMs`          | Timeout in ms when waiting for transaction confirmation.                    |
| `restoreFeeMultiplier`   | Multiplier applied to `minResourceFee` when building a restore transaction. |
| `archiveDetectionMethod` | Method for detecting archived keys: `'simulation'` (default) or `'direct'`. |

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
