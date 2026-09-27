# Proactive TTL Watch & Extend

Soroban ledger entries have a time-to-live (TTL). When an entry's TTL drops to
zero the entry is archived and any transaction that touches it must restore it
first. Instead of reacting to archives after the fact, you can watch an entry's
TTL and extend it *before* it expires.

The SDK exposes this through `watchTTL`, which polls the ledger for a set of
keys and, optionally, automatically extends them when they fall below a
threshold.

## Obtaining ledger keys

`watchTTL` operates on `LedgerKey` values. You can build them by hand, or — more
commonly — extract them from a transaction's footprint using the same helpers
the restore flow uses:

```typescript
import { SorobanResurrect, extractFootprintFromSuccess } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

// Simulate the transaction you care about and pull the keys it reads/writes.
const sim = await sr.simulate(transaction)
const keys = extractFootprintFromSuccess(sim)
```

If you already know the contract data keys you want to protect, construct them
directly with `xdr.LedgerKey.contractData(...)` and pass them in.

## Choosing `thresholdLedgers`

`thresholdLedgers` is the number of ledgers remaining before the watcher
considers a key "low" and fires `ttlLow` (and, in auto-extend mode, extends it).

- Too low and you risk the entry archiving between polls.
- Too high and you pay to extend entries far earlier than necessary.

A good starting point is a few thousand ledgers — enough headroom to survive a
poll interval plus some slack. The default is **1000 ledgers**.

## Observe-only mode

By default the watcher only reports. It emits `ttlLow` when a key crosses the
threshold and `ttlExtended` when a key's TTL is observed to have increased, but
it never submits a transaction:

```typescript
const handle = sr.watchTTL({
  keys,
  thresholdLedgers: 2000,
  onEvent: (event) => {
    if (event.type === 'ttlLow') {
      console.warn(`key ${event.key} is low: ${event.remainingLedgers} ledgers left`)
    }
    if (event.type === 'ttlExtended') {
      console.log(`key ${event.key} extended to ${event.remainingLedgers} ledgers`)
    }
  },
})

// Later, when you no longer need to watch:
handle.stop()
```

## Auto-extend mode

Set `autoExtend: true` to have the watcher build, sign, and submit an extend
operation whenever a key falls below the threshold. You must supply a signer and
the source account:

```typescript
const handle = sr.watchTTL({
  keys,
  thresholdLedgers: 2000,
  autoExtend: true,
  sourcePublicKey: keypair.publicKey(),
  signTransaction: async (tx) => {
    tx.sign(keypair)
    return tx
  },
  onEvent: (event) => {
    if (event.type === 'ttlExtended') {
      console.log(`extended ${event.key} to ${event.remainingLedgers} ledgers`)
    }
  },
})
```

## The event contract

`onEvent` receives a discriminated union:

| `event.type`   | Fields                                   | Meaning                                              |
| -------------- | ---------------------------------------- | ---------------------------------------------------- |
| `ttlLow`       | `key`, `remainingLedgers`                | A watched key dropped below `thresholdLedgers`.      |
| `ttlExtended`  | `key`, `remainingLedgers`                | A watched key's TTL increased (observed or applied). |
| `error`        | `key?`, `error`                          | A poll or extend attempt failed.                     |

## Interval and threshold defaults

The watcher polls every **30 seconds** (`intervalMs`) and treats a key as low
below **1000 ledgers** (`thresholdLedgers`). Override either per call:

```typescript
const handle = sr.watchTTL({
  keys,
  intervalMs: 10_000,      // poll every 10s
  thresholdLedgers: 5000,  // extend earlier
  autoExtend: true,
  sourcePublicKey: keypair.publicKey(),
  signTransaction: async (tx) => {
    tx.sign(keypair)
    return tx
  },
})
```

## Stopping the watcher

`watchTTL` returns a handle. Call `handle.stop()` to clear the polling timer and
release the watcher. After `stop()` no further events are emitted.

```typescript
const handle = sr.watchTTL({ keys })
// ...
handle.stop()
```
