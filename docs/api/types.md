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
  simulationTimeoutMs?: number // default: rpcTimeoutMs
  walletSigningTimeoutMs?: number // default: 120000
  restoreConfirmationTimeoutMs?: number // default: pollTimeoutMs
  originalSubmissionTimeoutMs?: number // default: rpcTimeoutMs
  restoreFeeMultiplier?: number // default: 3 — see "Choosing restoreFeeMultiplier" below
  maxRestoreFeeStroops?: FeeStroops | string // plain stroop strings are branded at the config boundary
  maxSequenceRetries?: number // default: 3 — retries when a restore tx fails on sequence number
  archiveDetectionMethod?: 'simulation' | 'direct' // default: 'simulation'
  archiveDetectionChunkSize?: number // default: 50
  archiveDetectionConcurrency?: number // default: 4
  maxBatchSize?: number // default: 100
  restoreTxMemo?: Memo
  restoreTxMemoText?: string // at most 28 UTF-8 bytes
  logger?: Logger
}
```

| Field                     | Description                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| `rpcUrl`                   | URL of the Soroban RPC endpoint.                                               |
| `networkPassphrase`        | Network passphrase (defaults to Testnet).                                      |
| `pollIntervalMs`           | Polling interval in ms when waiting for transaction confirmation.              |
| `pollTimeoutMs`             | Timeout in ms when waiting for transaction confirmation.                       |
| `simulationTimeoutMs`      | Maximum time in ms for simulation; defaults to `rpcTimeoutMs` (30 seconds unless configured). |
| `walletSigningTimeoutMs`   | Maximum time in ms for each wallet signature; defaults to 120 seconds.         |
| `restoreConfirmationTimeoutMs` | Maximum time in ms to wait for restore confirmation; defaults to `pollTimeoutMs`. |
| `originalSubmissionTimeoutMs` | Maximum time in ms to submit the original transaction; defaults to `rpcTimeoutMs` (30 seconds unless configured). |
| `restoreFeeMultiplier`     | Multiplier applied to `minResourceFee` when building a restore transaction.    |
| `maxRestoreFeeStroops`     | Upper bound on the restore fee. Accepts a branded `FeeStroops` or a plain numeric stroop string, which is branded at the config boundary. |
| `maxSequenceRetries`       | Number of times a restore transaction is retried after a sequence-number failure. |
| `archiveDetectionMethod`   | Method for detecting archived keys: `'simulation'` (default) or `'direct'`.    |
| `archiveDetectionChunkSize` | Ledger keys per `getLedgerEntries` request during `'direct'` detection.       |
| `archiveDetectionConcurrency` | Chunk requests kept in flight at once during `'direct'` detection.          |
| `maxBatchSize` | Maximum items accepted by `detectArchivedKeysBatch`, `submitBatchWithRestore`, and `restoreKeys`. Oversized batches fail with `BATCH_SIZE_EXCEEDED`. |
| `restoreTxMemo` | Optional Stellar memo attached to restore transactions. Only text and none memo types are accepted; text is limited to 28 UTF-8 bytes. |
| `restoreTxMemoText` | Convenience text memo for restore transactions, limited to 28 UTF-8 bytes (not 28 characters). May also be overridden per `submitWithRestore` call. |
| `logger` | Optional logger. Hardware-signing warnings are sent through its `warn` method. |

The memo limit is measured after UTF-8 encoding. For example, fourteen `é`
characters use 28 bytes and fit, while fifteen use 30 bytes and are rejected
during configuration resolution, before a wallet approval is requested.
`submitBatchWithRestore` uses one shared restore transaction; when that
transaction is needed, all per-item memo overrides must resolve to the same
memo.

## `SubmitWithRestoreOptions`

`submitWithRestore(options)` accepts per-request recovery controls. Retry is
**disabled by default**; opt in only for operations where repeating an RPC call
is acceptable:

```ts
const result = await sr.submitWithRestore({
  transaction,
  wallet,
  retry: {
    maxRetries: 3, // retries after the first attempt
    baseDelayMs: 250,
    maxDelayMs: 5_000,
  },
})
```

The SDK retries transient transport errors, HTTP 408/425/429/5xx responses,
known temporary network failures, and Soroban's explicit `TRY_AGAIN_LATER`
submission response. Backoff is exponential with jitter and is capped by
`maxDelayMs`. The retry wrapper applies only to RPC calls: it never repeats
wallet prompts, wallet rejection, invalid transaction errors, simulation
failures, on-chain failures, or deterministic contract errors. Because a
transport failure during submission can occur after the server accepted the
transaction, retries resend the same signed transaction bytes rather than
rebuilding or re-signing it.

| Option | Default when `retry` is supplied | Meaning |
| --- | ---: | --- |
| `maxRetries` | `3` | Number of additional RPC attempts; `0` disables retries for this request. |
| `baseDelayMs` | `250` | Initial exponential-backoff delay. |
| `maxDelayMs` | `5000` | Maximum delay between attempts. |

### Lifecycle events

`SubmitWithRestoreOptions.onLifecycleEvent` receives a discriminated
`SubmitLifecycleEvent` for each phase. The identical events are available to
instance subscribers through `sr.on('workflowLifecycle', listener)`:

```ts
const unsubscribe = sr.on('workflowLifecycle', (event) => {
  switch (event.phase) {
    case 'simulation_started':
    case 'restore_preparation_started':
    case 'restore_submission_started':
    case 'restore_submitted':
    case 'restore_confirmation_started':
    case 'restore_confirmed':
    case 'original_submission_started':
    case 'original_submitted':
    case 'original_confirmation_started':
    case 'original_confirmed':
    case 'completed':
    case 'failed':
      updateProgress(event)
      break
  }
})
```

Every event may include the supplied `requestId`; transaction hashes, detected
keys, terminal results, and errors are included when applicable. Call
`unsubscribe()` when the listener is no longer needed. Existing stage-specific
callbacks and events remain available.

### Logical request deduplication

Pass a stable, non-empty `requestId` to coalesce concurrent calls that represent
the same logical operation:

```ts
const options = { transaction, wallet, requestId: `withdrawal:${userActionId}` }
const [first, duplicate] = await Promise.all([
  sr.submitWithRestore(options),
  sr.submitWithRestore(options),
])
// Both callers receive the same result; only one restore/submission flow runs.
```

Deduplication is scoped to one SDK instance and only lasts while the request is
in flight. A later call using the same id starts a new attempt. Different ids
remain independent and may run concurrently. A coalesced caller receives the
first call's result; callbacks are invoked only for the call that started the
flow. Calls without `requestId` retain the prior, non-deduplicated behavior.
An empty or whitespace-only id returns a validation error without starting a
workflow.

### Confirmation policy and timeout

The default, `confirmationPolicy: 'wait-for-finality'`, waits until Soroban RPC
reports a terminal `SUCCESS` or `FAILED` status for the original transaction.
Successful results include `confirmationStatus: 'confirmed'`. This waits for
the ledger outcome rather than merely the RPC submission acknowledgment; it can
add polling latency and remains subject to the configured timeout.

Set `confirmationPolicy: 'return-on-submission'` to return after the RPC accepts
the original transaction. This yields `success: true` with
`confirmationStatus: 'submitted'`; it does **not** establish whether the
transaction later succeeds or fails. A required restore transaction is always
confirmed before the original transaction is rebuilt and submitted.

`confirmationTimeoutMs` overrides the configured `pollTimeoutMs` for restore
and original transaction confirmation. On timeout the default behavior returns
`success: false`, `errorCode: 'CONFIRMATION_TIMEOUT'`, and the submitted hash
without claiming an on-chain failure. Set
`confirmationTimeoutBehavior: 'return-pending'` to additionally report
`confirmationStatus: 'pending'`:

```ts
const result = await sr.submitWithRestore({
  transaction,
  wallet,
  confirmationTimeoutMs: 90_000,
  confirmationTimeoutBehavior: 'return-pending',
})

if (result.confirmationStatus === 'pending') {
  // The outcome is unknown; inspect the hash or resume polling.
  console.log(result.originalTxHash ?? result.restoreTxHash)
}
```

When RPC reports a terminal `FAILED` status, the result instead uses
`ORIGINAL_TX_FAILED` (or `RESTORE_TX_FAILED` for a restore failure) and includes
decoded `onchainError` information when available.

Restore workflows now wait for the original transaction's terminal status
before reporting success, correcting the former early-return behavior for that
path. Applications that relied on the earlier return can opt into
`return-on-submission`.

These phase timeouts are independent. Existing callers can omit them to use
their documented defaults; set one or more explicitly when the application
needs tighter bounds for a particular step. A timeout stops waiting for the
operation but does not cancel a wallet prompt or RPC request already in flight.

## `ArchivedLedgerEntry`

An archived ledger key returned by detection and restore helpers. The public
representation contains its XDR ledger key, the ledger-entry classification,
and TTL metadata when the lookup provided it; it never contains wallet signing
material or other secrets.

```typescript
interface ArchivedLedgerEntry {
  key: xdr.LedgerKey
  keyBase64: XdrBase64
  entryType?: 'contractData' | 'contractCode' | 'other'
  liveUntilLedger?: number
  currentLedger?: number
  ttlLedgers?: number
}
```

The SDK populates `entryType` for detected keys. TTL metadata is optional
because simulation-only detection may not perform a separate ledger query.

## `LedgerEntryTTLInfo`

One result from `queryLedgerTTL`, `queryLedgerEntryTTL`, or a contract scan.

| Field | Meaning |
| --- | --- |
| `status` | `'live'` when the ledger returned a TTL, otherwise `'unavailable'`. |
| `unavailableReason` | `'missing'`, `'expired'`, `'unsupported'`, `'rpc_error'`, or `'ttl_unavailable'`. |
| `isArchived` | `true` only for confirmed missing or expired entries; RPC failures and unsupported keys are never treated as archived. |
| `liveUntilLedger` / `ttlLedgers` | Expiration sequence and remaining ledgers when available. |
| `entryType` | `'contractData'`, `'contractCode'`, or `'other'`. |

Chunk failures are also returned in `failedChunks` and summarized by `hasErrors`.
This lets callers distinguish a confirmed missing key from an RPC failure without
guessing from a zero TTL.

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

const myWallet: WalletAdapter = {
  async isConnected() {
    return true
  },
  async getPublicKey() {
    return 'G...'
  },
  async signTransaction(tx) {
    return tx
  },
}
```

## Contract and account scanning

These APIs answer "what in my contract is about to expire?" **without submitting a
transaction**. They read ledger entries directly, so they are safe to call on page
load, in a background poll, or before you decide whether a restore is needed.

> **Important limitation — contract storage keys cannot be enumerated.**
> Soroban does not expose a way to list the storage keys a contract holds. The
> scan functions therefore only check the keys **you supply**. If you omit a key,
> it will not be scanned, and an expiring entry behind it will be missed. You are
> responsible for knowing your contract's instance, wasm code, and storage keys.

### `getExpiringEntriesForContract`

Scans a contract's instance entry, its wasm code entry, and any storage keys you
provide, returning the ones that are already archived or expiring soon.

```typescript
function getExpiringEntriesForContract(
  contractId: string,
  options?: ContractScanOptions,
): Promise<ContractScanResult>
```

```typescript
interface ContractScanOptions {
  /** Storage keys to scan. Required to cover contract data — see the caveat above. */
  storageKeys?: LedgerKey[]
  /** Include the contract instance entry. Default: true. */
  includeInstance?: boolean
  /** Include the contract's wasm code entry. Default: true. */
  includeWasmCode?: boolean
  /** Ledgers remaining below which an entry counts as "expiring soon". */
  expiringSoonLedgers?: number
}
```

```typescript
interface ContractScanResult {
  contractId: string
  /** Every scanned entry, with its status and remaining TTL. */
  entries: ClassicEntryStatus[]
  /** Entries that are already archived. */
  archived: ClassicEntryStatus[]
  /** Entries that are still live but expiring soon. */
  expiringSoon: ClassicEntryStatus[]
}
```

### `getExpiringEntriesForAccount`

Scans an account's presence and its trustlines. This is a **presence scan**, not a
TTL scan: it reports whether the account and each trustline entry still exist on
ledger, so you can detect accounts that have been merged away or trustlines that
have been removed.

```typescript
function getExpiringEntriesForAccount(
  accountId: string,
  options?: AccountScanOptions,
): Promise<ContractScanResult>
```

```typescript
interface AccountScanOptions {
  /** Trustline asset keys to check. Omit to scan only the account entry. */
  trustlines?: LedgerKey[]
}
```

### `ClassicEntryStatus`

One scanned entry and its current state.

```typescript
interface ClassicEntryStatus {
  /** The ledger key that was scanned. */
  key: LedgerKey
  /** 'live' | 'archived' | 'expiring-soon' | 'missing'. */
  status: 'live' | 'archived' | 'expiring-soon' | 'missing'
  /** Ledgers remaining before expiry, when known. */
  remainingLedgers?: number
}
```

### `DEFAULT_EXPIRING_SOON_LEDGERS`

The default threshold (in ledgers) below which a live entry is reported as
`'expiring-soon'`. Pass `expiringSoonLedgers` in `ContractScanOptions` to override
it per call.

```typescript
const DEFAULT_EXPIRING_SOON_LEDGERS: number
```

### Worked example

Scan a contract's instance, wasm code, and a storage key, then scan an account and
one of its trustlines:

```typescript
import {
  getExpiringEntriesForContract,
  getExpiringEntriesForAccount,
  xdr,
} from '@soroban-resurrect/sdk'

// Contract scan: instance + wasm code are included by default; storage keys
// must be supplied by the caller because they cannot be enumerated.
const contract = await getExpiringEntriesForContract(contractId, {
  includeInstance: true,
  includeWasmCode: true,
  storageKeys: [
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: xdr.ScAddress.scAddressTypeContract(contractId),
        key: xdr.ScVal.scvSymbol('counter'),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    ),
  ],
})

if (contract.archived.length > 0 || contract.expiringSoon.length > 0) {
  // Decide whether to restore before submitting a transaction.
}

// Account scan: presence of the account entry and its trustlines.
const account = await getExpiringEntriesForAccount(accountId, {
  trustlines: [
    xdr.LedgerKey.trustline(
      new xdr.LedgerKeyTrustLine({
        accountId: xdr.AccountId.publicKeyTypeEd25519(accountId),
        asset: xdr.TrustLineAsset.assetTypeCreditAlphanum4(
          new xdr.AlphaNum4({
            assetCode: Buffer.from('USDC'),
            issuer: xdr.AccountId.publicKeyTypeEd25519(issuerId),
          }),
        ),
      }),
    ),
  ],
})
```

### When to use scanning vs. `detectArchivedKeys`

| | `getExpiringEntriesFor*` | `detectArchivedKeys` |
| --- | --- | --- |
| Input | Contract/account id plus the keys you supply | A transaction footprint |
| Transaction | None — read-only | None — read-only |
| Answers | "What is archived or expiring soon?" | "Which keys in this transaction are archived?" |
| Use when | You want a proactive, pre-transaction view of a contract or account | You already have a transaction and want to know if it needs a restore first |

Use the scan functions to build a dashboard or a pre-flight check. Use
`detectArchivedKeys` when you have a specific transaction in hand and want to know
whether its footprint touches archived entries.
