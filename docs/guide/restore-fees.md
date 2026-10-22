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

## Estimating restore fees

`estimateRestoreCost` is the stable, documented interface for fee estimation.
It takes the same inputs the restore path uses and returns the exact fee the
restore will charge, so callers never have to re-implement the formula.

```ts
import { estimateRestoreCost } from '@stellar/restore';

const estimate = await estimateRestoreCost({
  minResourceFee,          // from the restore simulation
  restoreFeeMultiplier,    // defaults to 1
  maxRestoreFeeStroops,    // optional cap
});

// estimate.feeStroops is the exact amount the restore will charge.
// estimate.capped is true when the cap clamped the fee.
```

Estimate **before** you build or sign the restore transaction, and pass the
result into your consent UI. Because the estimate uses the same formula as the
restore path, the number you show the user is the number they will pay.

## Distinguishing restore fees from the original transaction cost

A restore fee is **not** the cost of the original transaction. They are
separate charges and must be presented separately:

- **Original transaction cost** — the fee paid when the original transaction
  was first submitted. It is already settled and is not charged again by a
  restore.
- **Restore fee** — the additional fee paid now to bring the archived entry
  back into the live ledger. It is computed by the formula above and is the
  only new cost a restore introduces.

When you present costs to users, label them explicitly (for example,
"Original transaction fee (already paid)" and "Restore fee (charged now)") and
never sum them into a single "total" that implies the original fee is being
charged again. The restore fee is the amount that requires fresh consent.

## User-consent UX patterns

A restore spends the user's funds, so it requires explicit consent. The
following patterns keep consent clear and auditable:

1. **Estimate first, then ask.** Call `estimateRestoreCost` before showing any
   prompt. Never ask for consent to an unknown amount.
2. **Show the fee and its basis.** Display the restore fee in stroops (and a
   human-readable unit if you have one), and state that it is separate from the
   original transaction cost.
3. **Surface the cap.** If `estimate.capped` is true, tell the user the fee was
   clamped to `maxRestoreFeeStroops` so the number is not surprising.
4. **Explain what is being restored.** Name the archived entries being restored
   so the user understands what the fee buys.
5. **Require an explicit action.** Use a distinct confirm control (not a
default-focused button) so consent is deliberate, and record the accepted
estimate alongside the signed transaction for auditability.
6. **Handle staleness.** If the ledger-bounds window elapses while the prompt
   is open, the SDK fails without submitting. Re-estimate and re-prompt rather
   than silently reusing the old consent.

These patterns rely only on the stable `estimateRestoreCost` interface and the
restore error codes documented below, so they remain valid across SDK versions.

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
- Present the restore fee separately from the original transaction cost and
  obtain explicit consent using the patterns above.

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
   sequence number and sets it on the rebuilt transacti
