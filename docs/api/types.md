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
  maxRestoreFeeStroops?: FeeStroops | string // plain stroop strings are branded at the config boundary
  maxSequenceRetries?: number // default: 3 — retries when a restore tx fails on sequence number
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
| `maxRestoreFeeStroops`     | Upper bound on the restore fee. Accepts a branded `FeeStroops` or a plain numeric stroop string, which is branded at the config boundary. |
| `maxSequenceRetries`       | Number of times a restore transaction is retried after a sequence-number failure. |
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
