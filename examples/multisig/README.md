# Multisig restore example (2-of-3)

Demonstrates restoring archived state for an account protected by a 2-of-3
multisig using `MultiSigWalletAdapter`. The flow is always:

1. **Build** the transaction.
2. **Collect** signatures with `collectSignatures()` — it merges every
   signature and reports `signerCount`, `weight` and `thresholdMet` without
   throwing, so the UI can show which signers have signed and which are missing.
3. **Submit** with `submitWithRestore({ wallet: multisig })` (or
   `restoreKeys(keys, multisig)`). `signTransaction()` throws if the threshold
   is not met, so an under-signed restore is never sent.

Tick **Signer "Carol" refuses** to see a refusal surfaced in the UI — with
two of three signing, the restore still proceeds; the refusal is shown next
to Carol's name. The example runs against a mocked RPC by default; untick
**Mocked RPC** to submit to testnet (the signer keys must then be real
signers on a funded account).

## Multisig restore vs. `restoreKeys`

- Use a plain wallet with `restoreKeys` / `submitWithRestore` when the source
  account has a single signer (the common case).
- Use `MultiSigWalletAdapter` when the source account's medium threshold
  requires signatures from several keys (DAO treasuries, custody setups). It
  implements `WalletAdapter`, so it is passed to the same `restoreKeys` /
  `submitWithRestore` calls — multisig changes _who signs_, not _how you restore_.

## Run

```bash
npm install
npm run dev -w examples/multisig
```
