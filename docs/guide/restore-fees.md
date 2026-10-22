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

## DeFi position recovery example

A worked example of restoring a DeFi contract position lives in
`examples/defi-position-recovery`. It demonstrates the full flow a dApp should
follow: detect that a position's ledger entries are archived, preview the
recovery cost with `estimateRestoreCost`, present the recovery transaction and
its fees to the user for review, and only then request a signature and submit.

### Presenting the recovery transaction and fees before signing

Before asking the user to sign, a dApp should surface three things so the
recovery is transparent:

1. **What is being restored** — the contract position and the archived ledger
   entries the recovery touches.
2. **The fee** — the value returned by `estimateRestoreCost`, which already
   includes the multiplier and any cap. Show it in stroops and in the display
   unit your users expect.
3. **The validity window** — the ledger range from `RESTORE_TX_LEDGER_BOUNDS_WINDOW`
   so users understand how long the signed transaction stays valid.

The example builds a review object from the estimate and the restore
footprint, renders it, and only calls the signing path after the user confirms.
If the footprint-size guard warns, the example shows the warning alongside the
fee so the user can decide whether to proceed or split the restore.

### Compatibility and migration notes

- The example uses the same `estimateRestoreCost` and footprint-size guard
  documented above, so the fee it shows matches what the restore charges.
- If you previously computed restore fees by hand, replace that logic with
  `estimateRestoreCost` so the multiplier and cap are applied consistently.
- If your dApp signs restores without a review step, add one: present the
  estimate and validity window before requesting a signature, and handle the
  `INCOMPLETE_FOOTPRINT` error by retrying only after a complete simulation
  response is available.

## Summary

- The fee is `minResourceFee * restoreFeeMultiplier`, optionally clamped to
  `maxRestoreFeeStroops`.
- The footprint-size guard is evaluated first and warns when close to the limit
  and throws when over it.
- Use `estimateRestoreCost` to preview the exact fee before signing.
- The DeFi position recovery example shows how to present the recovery
  transaction and fees to users before they sign.
