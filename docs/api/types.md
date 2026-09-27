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

## `KnownWallet`

Union of the wallet identifiers the SDK ships adapters for. Pass one of these to
[`createAdapter`](#createadapter) to get a ready-to-use `WalletAdapter`.

```typescript
type KnownWallet =
  | 'freighter'
  | 'xbull'
  | 'albedo'
  | 'ledger'
  | 'trezor'
```

| Value       | Adapter                  | Notes                                                                 |
| ----------- | ------------------------ | --------------------------------------------------------------------- |
| `freighter` | `FreighterWalletAdapter` | Browser extension; injected `window.freighterApi`.                    |
| `xbull`     | `XBullWalletAdapter`     | Browser extension; injected `window.xBullSDK`.                        |
| `albedo`    | `AlbedoWalletAdapter`    | Web-based signer; no extension required.                              |
| `ledger`    | `LedgerWalletAdapter`    | Hardware; requires a transport and a manifest — see below.            |
| `trezor`    | `TrezorWalletAdapter`    | Hardware; requires a transport and a manifest — see below.            |

`SUPPORTED_WALLETS` is the runtime array of every `KnownWallet` value, in the
order shown above. Use it to render a wallet picker without hard-coding the list:

```typescript
import { SUPPORTED_WALLETS } from '@soroban-resurrect/sdk'

SUPPORTED_WALLETS // ['freighter', 'xbull', 'albedo', 'ledger', 'trezor']
```

## `createAdapter`

Factory that returns a `WalletAdapter` for a given `KnownWallet` (or a custom
adapter you supply). It is the recommended entry point — it keeps the
capability flags and hardware configuration in one place.

```typescript
function createAdapter(
  wallet: KnownWallet,
  config?: LedgerAdapterConfig | TrezorAdapterConfig,
): WalletAdapter
```

```typescript
import { createAdapter } from '@soroban-resurrect/sdk'

const wallet = createAdapter('freighter')
const publicKey = await wallet.getPublicKey()
```

### Capabilities

Every adapter exposes a `capabilities` object. The SDK reads these flags to
decide which code paths are safe to take:

```typescript
interface WalletCapabilities {
  signTransaction: boolean
  signAuthEntry: boolean
  hardware: boolean
  blindSigning: boolean
}
```

| Flag              | Meaning                                                                 | SDK behaviour that depends on it                                                                 |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `signTransaction` | The adapter can sign a full transaction.                                | Required by `submitWithRestore`; if `false`, the workflow throws before submitting.              |
| `signAuthEntry`   | The adapter can sign a Soroban auth entry.                              | Enables the auth-entry signing path; skipped when `false`.                                       |
| `hardware`        | The adapter signs on a physical device.                                 | Switches the workflow to hardware UX: longer timeouts and signing prompts that wait for the device. |
| `blindSigning`    | The device can sign a payload it cannot fully display.                  | When `false`, the SDK warns before requesting a signature that would be blind-signed.            |

### Hardware setup (Ledger and Trezor)

Hardware adapters need a transport to talk to the device and a manifest so the
device can show what it is signing. Install the transport packages alongside the
SDK:

```bash
# Ledger
npm install @ledgerhq/hw-transport-webhid @ledgerhq/hw-app-str

# Trezor
npm install @trezor/connect-web
```

Then pass the transport and manifest through the adapter config:

```typescript
import { createAdapter } from '@soroban-resurrect/sdk'
import TransportWebHID from '@ledgerhq/hw-transport-webhid'

const ledger = createAdapter('ledger', {
  transport: await TransportWebHID.create(),
  manifest: {
    name: 'My Soroban App',
    url: 'https://example.com',
    icon: 'https://example.com/icon.png',
  },
})
```

```typescript
import { createAdapter } from '@soroban-resurrect/sdk'

const trezor = createAdapter('trezor', {
  manifest: {
    email: 'dev@example.com',
    appUrl: 'https://example.com',
  },
})
```

`LedgerAdapterConfig` and `TrezorAdapterConfig` are the config types accepted by
`createAdapter` for the `'ledger'` and `'trezor'` wallets respectively. Both
require a `manifest`; the Ledger config additionally requires a `transport`.

### Hardware latency and UX

Hardware signing is slower and more interactive than extension wallets. Expect:

- **Latency** — each signature requires a round-trip to the device, so signing
  can take several seconds versus near-instant for extension wallets. Keep
  `pollTimeoutMs` generous when the workflow includes hardware signing.
- **Confirmation** — the user must physically confirm on the device. The SDK
  surfaces this through the `onSigningRestore` / `onSigningOriginal` callbacks so
  your UI can prompt the user to check the device.
- **Blind signing** — when `capabilities.blindSigning` is `false`, the SDK warns
  before a signature the device cannot display, so users are not asked to approve
  an opaque payload.

### Custom adapters

If your wallet is not in `KnownWallet`, implement `WalletAdapter` directly and
pass it wherever a `WalletAdapter` is expected:

```typescript
import type { WalletAdapter } from '@soroban-resurrect/sdk'

const myAdapter: WalletAdapter = {
  async isConnected() {
    return Boolean(window.myWallet)
  },
  async getPublicKey() {
    return window.myWallet.getPublicKey()
  },
  async signTransaction(tx, opts) {
    return window.myWallet.sign(tx, opts?.networkPassphrase)
  },
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
