# Restore fees and limits

Restoring an archived ledger entry costs a fee. The fee is derived from the
resource fee the network charges for the restore operation, scaled by a
configurable multiplier, and optionally capped. A footprint-size guard rejects
restores that would touch too many entries before any fee is charged.

This page documents the full fee model end to end: the formula, all four
interacting knobs, their defaults, how to preview the cost before signing, and
how the size guard warns or throws.

## The formula

```
restoreFee = minResourceFee * restoreFeeMultiplier
restoreFee = min(restoreFee, maxRestoreFeeStroops)   // only when the cap is set
```

- `minResourceFee` is the minimum resource fee the network reports for the
  restore operation (in stroops). It is the base cost before any multiplier is
  applied.
- `restoreFeeMultiplier` scales that base cost. It defaults to `1`, meaning the
  fee equals the raw `minResourceFee`.
- `maxRestoreFeeStroops` is an optional hard cap. When set, the computed fee is
  clamped to this value. When unset (the default), no cap is applied.
- The footprint-size guard is a separate limit: it bounds how many ledger
  entries a single restore may touch and is evaluated before the fee is
  computed.

## The four knobs

| Knob | Meaning | Default |
| --- | --- | --- |
| `minResourceFee` | Base resource fee for the restore, in stroops | Reported by the network |
| `restoreFeeMultiplier` | Multiplier applied to `minResourceFee` | `1` |
| `maxRestoreFeeStroops` | Optional hard cap on the computed fee, in stroops | unset (no cap) |
| footprint-size guard | Maximum number of entries a restore may touch | see `constants.ts` |

The defaults above match `config/defaults.json` and `constants.ts`. If you
change them in code, update this table so the documentation stays in sync.

## When to raise the multiplier

`restoreFeeMultiplier` exists so operators can pay more than the bare minimum
when they want a restore to be prioritised or when the network's reported
`minResourceFee` understates the real cost of the operation. Raise it when:

- restores are being deprioritised and you want them to land faster, or
- the reported `minResourceFee` is consistently lower than the fee you are
  willing to pay.

Leave it at the default `1` when you want to pay exactly the reported minimum.

## How the cap interacts with `estimateRestoreCost`

`estimateRestoreCost` is the way to preview the cost before signing. It applies
the same formula the restore path uses, including the multiplier and the cap, so
the number it returns is the number you will pay:

- If the uncapped fee is **at or below** `maxRestoreFeeStroops`, the estimate
  equals `minResourceFee * restoreFeeMultiplier`.
- If the uncapped fee is **over** `maxRestoreFeeStroops`, the estimate is clamped
  to the cap.
- If no cap is set, the estimate is always the uncapped fee.

Always call `estimateRestoreCost` before signing a restore so you can reason
about what you will pay and surface the cap to your users.

## Restore preamble freshness

Restore transactions use ledger bounds derived from the simulation's
`latestLedger`. The default validity window is exposed as
`RESTORE_TX_LEDGER_BOUNDS_WINDOW` (30 ledgers). After wallet approval, the SDK
checks the signed transaction's bounds and current ledger before submitting.
If the window has elapsed, or the transaction's 30-second time bound expired
while the wallet prompt was open, the SDK fails without sending it and returns
an error asking the caller to rebuild and request a new signature. Wallets that
display transaction preconditions should show the ledger range as part of the
restore transaction details.

## Incomplete simulation footprints

The SDK does not build or submit a restore when a restore simulation cannot
provide a complete, non-empty read-write footprint. `extractArchivedKeys`
throws `IncompleteFootprintError`; `submitWithRestore` returns
`errorCode: 'INCOMPLETE_FOOTPRINT'`. The error includes a `condition` such as
`unparsed-response`, `missing-transaction-data`,
`missing-read-write-entries`, or `empty-read-write-footprint`, so callers can
report the specific RPC response problem. Retry only after the endpoint
returns a complete simulation response; do not construct a restore from an
empty fallback footprint.

## The footprint-size guard

The size guard runs before the fee is computed. It counts the ledger entries in
the restore footprint and compares that count against the configured maximum:

- **Within the limit:** the restore proceeds and the fee is computed normally.
- **Over the limit:** the guard throws, and no fee is charged.

When the footprint is close to the limit, the guard emits a warning so callers
can react before the restore is rejected. Treat the warning as a signal to
reduce the footprint or split the restore into smaller operations.

## Worked example

Suppose the network reports `minResourceFee = 100` stroops, the multiplier is
`2`, and the cap is `150` stroops.

1. Uncapped fee: `100 * 2 = 200` stroops.
2. The cap is `150`, and `200 > 150`, so the fee is clamped to `150` stroops.
3. `estimateRestoreCost` returns `150` stroops, matching what the restore will
   charge.

If the cap were unset, the fee would be the uncapped `200` stroops. If the
multiplier were left at the default `1`, the fee would be `100` stroops, which
is at or below the cap and therefore not clamped.

## Summary

- The fee is `minResourceFee * restoreFeeMultiplier`, optionally clamped to
  `maxRestoreFeeStroops`.
- The footprint-size guard is evaluated first and warns when close to the limit
  and throws when over it.
- Use `estimateRestoreCost` to preview the exact fee before signing.

## Architecture decision record: rebuilding the original transaction

This section is the architecture decision record (ADR) for how the SDK handles
the original transaction after a restore. It records the decision, the
rationale, and the mechanism so future changes can be evaluated against it.

### Status

Accepted.

### Context

A restore is a two-step flow. The SDK first simulates the restore to learn the
archived keys, the resource fee, and the ledger state. It then builds and signs
the actual restore transaction. Between simulation and submission the caller
may need to obtain a signature (for example, through a wallet prompt), which can
take an arbitrary amount of time.

During that gap the network moves on: the current ledger advances, the
simulation's `latestLedger` becomes stale, and the signed transaction's ledger
bounds and time bound can expire. A restored transaction that was valid at
simulation time may no longer be valid at submission time.

### Decision

After restoration, the SDK rebuilds the original transaction from the latest
simulation data rather than reusing the previously built or restored
transaction. The rebuilt transaction is what gets signed and submitted.

### Rationale

- **Freshness.** Rebuilding re-derives ledger bounds from the current
  simulation's `latestLedger`, so the transaction is valid against the ledger
  the network is actually on, not the one it was on when the flow started.
- **Correct sequence numbers.** The account's sequence number advances as
  transactions are submitted. Reusing a stale transaction would carry an
  outdated sequence number and be rejected. Rebuilding reads the current
  sequence number so the transaction is accepted.
- **Consistent simulation data.** The footprint, resource fee, and other
  simulation-derived fields are taken from the same simulation that produced
  the ledger bounds, so the transaction is internally consistent.
- **Clear failure mode.** If the window has elapsed, rebuilding fails fast with
  an error asking the caller to rebuild and request a new signature, instead of
  submitting a transaction that is doomed to fail.

### Mechanism

1. **Sequence numbers.** The rebuild reads the source account's current
   sequence number and sets it on the rebuilt transaction. It does not carry
   over the sequence number from the restored transaction, which may have been
   consumed or superseded.
2. **Simulation data.** The rebuild uses the restore simulation's
   `latestLedger` to derive ledger bounds within
   `RESTORE_TX_LEDGER_BOUNDS_WINDOW` (30 ledgers) and applies the 30-second time
   bound. The footprint and `minResourceFee` come from the same simulation, so
   the fee formula above is evaluated against current data.
3. **Caller responsibilities.** The caller must:
   - request a new signature for the rebuilt transaction, since the previous
     signature no longer applies;
   - surface the new ledger range and time bound to users when the wallet
     displays preconditions;
   - handle the rebuild-and-resign error by retrying the flow, not by
     resubmitting the stale transaction.

### Consequences

- Callers must be prepared to sign more than once if the window elapses.
- The SDK never submits a transaction whose bounds or sequence number are
  stale; it fails fast and asks for a rebuild instead.
- Any change to the restore flow must preserve the invariant that the signed
  transaction is rebuilt from current simulation data.
