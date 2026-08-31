# Types

All types below are exported from `@soroban-resurrect/sdk`.

## `SorobanResurrectConfig`

Configuration options for creating a `SorobanResurrect` instance.

This is the single canonical reference for every field. It is kept in sync with the
`SorobanResurrectConfig` interface in
[`packages/sdk/src/types.ts`](../../packages/sdk/src/types.ts) — if you add or change a field
there, update the snippet and table below in the same change. The `README.md` config snippet
links back to this page rather than repeating the field list, so there is exactly one place for
this drift to happen instead of three.

```typescript
interface SorobanResurrectConfig {
  rpcUrl: string
  networkPassphrase?: string // default: Testnet
  pollIntervalMs?: number // default: 1000
  pollTimeoutMs?: number // default: 60000
  restoreFeeMultiplier?: number // default: 3
  archiveDetectionMethod?: 'simulation' | 'direct' // default: 'simulation'
  enableSimulationCache?: boolean // default: false
  useSSE?: boolean // default: false
  rpcClient?: ISorobanRpcClient // default: undefined (creates one from rpcUrl)
}
```

| Field                    | Description                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rpcUrl`                 | URL of the Soroban RPC endpoint.                                                                                                                          |
| `networkPassphrase`      | Network passphrase (defaults to Testnet).                                                                                                                 |
| `pollIntervalMs`         | Polling interval in ms when waiting for transaction confirmation.                                                                                         |
| `pollTimeoutMs`          | Timeout in ms when waiting for transaction confirmation.                                                                                                  |
| `restoreFeeMultiplier`   | Multiplier applied to `minResourceFee` when building a restore transaction. See "Restore fee model" below.                                                |
| `archiveDetectionMethod` | Method for detecting archived keys: `'simulation'` (default, piggybacks on the transaction's own simulation) or `'direct'` (queries the ledger directly). |
| `enableSimulationCache`  | Caches simulation responses to reduce RPC calls when the same transaction is simulated repeatedly (e.g. across retries).                                  |
| `useSSE`                 | Uses SSE-based transaction status waiting when the RPC endpoint and runtime support it, falling back to adaptive polling otherwise.                       |
| `rpcClient`              | A pre-built `ISorobanRpcClient` to use instead of creating one from `rpcUrl` — for dependency injection and test doubles.                                 |

### Restore fee model

A restore transaction's fee is `minResourceFee × restoreFeeMultiplier`, where `minResourceFee`
comes from simulating the restore and `restoreFeeMultiplier` defaults to **3** (`RESTORE_FEE_MULTIPLIER`
in `constants.ts` — the single source of truth for the default; nothing else hardcodes it).

Earlier versions of this SDK defaulted to `100×`, which could significantly overpay on Mainnet
during normal conditions. `3×` is a reasonable balance for typical usage. Raise it when you need
more headroom:

- **Raise the multiplier** (e.g. `5`–`10`) when restore transactions are failing to get included
  during network congestion — a higher fee makes inclusion more likely at the cost of overpaying
  when the network isn't congested.
- **Lower it** (down to the minimum of `1`) when you want the cheapest possible restore and can
  tolerate occasional inclusion delay — acceptable for background/maintenance restores that aren't
  blocking a user-facing action.
- The value must be a finite number `>= 1`; `resolveConfig` throws
  `config.restoreFeeMultiplier must be a finite number greater than or equal to 1` otherwise.

```typescript
const resurrect = new SorobanResurrect({
  rpcUrl: 'https://soroban-rpc.mainnet.stellar.org',
  restoreFeeMultiplier: 5, // more headroom during Mainnet congestion
})
```

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
