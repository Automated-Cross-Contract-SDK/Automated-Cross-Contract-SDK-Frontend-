# Restore cost estimator example

Shows the pre-signature cost-confirmation pattern: build a transaction, call
`estimateRestoreCost()` (simulation only — nothing is signed or submitted),
show the user _"this needs a restore and will cost about N stroops"_, and only
then ask the wallet to sign via `submitWithRestore()`.

The UI displays `archivedKeysDetected`, the simulated `minResourceFee`, the
configured `restoreFeeMultiplier` and `maxRestoreFeeStroops` cap. When no
restore is needed the estimate is a zero-cost path (`wouldNeedRestore: false`,
`estimatedFee: "0"`). Two mock modes let you see both cases without a wallet.

## Reconciling the estimate with the charged fee

- `estimatedFee` is `minResourceFee × restoreFeeMultiplier` — it is the **fee
  bid** placed on the restore transaction, i.e. an upper bound. The network
  charges the resources actually consumed, so the charged fee is usually lower;
  unused resource fee is refunded.
- The estimate covers the **restore** transaction only. The original
  transaction's own fee is charged separately on top.
- Ledger state can change between estimate and submit (another user may
  restore or extend the entry), so the real restore may cost less or be skipped.
- Read the actual charge from the submitted transaction's result
  (`feeCharged` in `getTransaction` / Horizon) and compare it with the estimate.
- If `estimatedFee` exceeds `maxRestoreFeeStroops`, the SDK refuses to build
  the restore; show this to the user before they sign.

## Run

```bash
npm install
npm run dev -w examples/cost-estimator
```
