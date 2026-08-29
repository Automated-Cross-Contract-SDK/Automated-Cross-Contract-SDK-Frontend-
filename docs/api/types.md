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
  enableSimulationCache?: boolean // default: false
  useSSE?: boolean // default: false
  rpcClient?: ISorobanRpcClient // default: auto-created SorobanRpcClient(rpcUrl)
}
```

| Field                     | Default                                     | Description                                                                                            |
| -------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `rpcUrl`                   | — (required)                                 | URL of the Soroban RPC endpoint.                                                                            |
| `networkPassphrase`        | Resolved from `rpcUrl`, else Testnet         | Network passphrase. Must be one of the known Stellar network passphrases.                                   |
| `pollIntervalMs`           | `1000`                                       | Polling interval in ms when waiting for transaction confirmation.                                           |
| `pollTimeoutMs`             | `60000`                                      | Timeout in ms when waiting for transaction confirmation.                                                    |
| `restoreFeeMultiplier`     | `3`                                          | Multiplier applied to `minResourceFee` when building a restore transaction. Must be a finite number `>= 1`. |
| `archiveDetectionMethod`   | `'simulation'`                               | Method for detecting archived keys: `'simulation'` or `'direct'`.                                           |
| `enableSimulationCache`    | `false`                                      | Cache simulation results per transaction to reduce redundant RPC calls.                                     |
| `useSSE`                   | `false`                                      | Use SSE-based transaction status waiting when the RPC endpoint supports it.                                 |
| `rpcClient`                | Auto-created `SorobanRpcClient` from `rpcUrl`| Inject a custom {@link ISorobanRpcClient} — a test double, caching wrapper, or rate-limiter. See [Testing](/guide/testing). |

## Choosing `restoreFeeMultiplier`

`restoreFeeMultiplier` scales `minResourceFee` (the fee simulation reports as the
minimum needed) into the fee actually attached to the restore transaction:

```
restoreFee = minResourceFee * restoreFeeMultiplier
```

The default is `3` — a deliberate balance between two failure modes:

- **Too low (close to `1`)**: the restore transaction is cheap, but during network
  congestion the actual required fee can exceed `minResourceFee`, so the transaction
  fails to be included and the whole restore-and-submit workflow has to retry.
- **Too high**: the restore transaction is virtually guaranteed to be included, but
  the caller (or their sponsor, under a fee-bump) overpays — an earlier default of
  `100` could mean paying up to 100x the base fee for a single restore.

Guidance:

- Keep the default (`3`) for typical Testnet/Mainnet usage — it already builds in
  headroom over the simulated minimum.
- Raise it (e.g. `5`–`10`) if you observe restore transactions failing to be
  included during periods of network congestion, or if your application cannot
  tolerate a retry.
- Lower it (e.g. `1`–`2`) only when minimizing fees matters more than inclusion
  reliability and you can tolerate occasional retries.
- The multiplier is validated at config-resolution time — passing a value `< 1` or
  non-finite throws immediately rather than producing a malformed transaction.

There is no separate cost-estimation API — to project the restore fee ahead of
time, simulate the transaction (`resurrect.simulate(tx)` or
`resurrect.detectArchivedKeys(tx)`) and compute
`Number(response.minResourceFee) * resurrect.config.restoreFeeMultiplier` from the
result.

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

| Callback               | Fires when...                                                             |
| ------------------------ | ------------------------------------------------------------------------------ |
| `onRestoreNeeded`         | Archived entries are detected and restoration is required.                    |
| `onSigningRestore`        | Restore transaction is ready to be signed.                                    |
| `onSubmittingRestore`     | Restore transaction is signed and about to be submitted.                      |
| `onRestoreSubmitted`      | The restore transaction has been submitted.                                   |
| `onRestoreConfirmed`      | The restore transaction is confirmed on-chain.                                |
| `onSigningOriginal`       | The restore step (if any) is done and the original tx is ready to sign.        |
| `onOriginalSubmitted`     | The original transaction has been submitted.                                  |
| `onRestoreFailed`         | The restore step of the workflow fails.                                       |

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
```

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
