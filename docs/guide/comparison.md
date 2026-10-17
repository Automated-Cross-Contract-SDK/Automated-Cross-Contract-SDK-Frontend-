# Manual restore flow vs. the SDK

Soroban archival recovery is a short protocol flow, but applications must get
each transaction boundary right. This page compares a hand-rolled implementation
with `@soroban-resurrect/sdk`; neither approach is right for every application.

## What a hand-rolled flow does

A minimal implementation typically simulates the transaction, handles a
restore-required response, submits a `restoreFootprint` transaction, waits for
confirmation, then rebuilds and submits the original transaction. The
[Soroban RPC `simulateTransaction` response](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/simulateTransaction)
provides the restore footprint and resource fee; the
[Stellar SDK `restoreFootprint` operation](https://stellar.github.io/js-stellar-sdk/Operation.html#.restoreFootprint)
builds the restore operation. The RPC's
[`sendTransaction`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction)
and [`getTransaction`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction)
methods submit it and report its eventual status.

```ts
const simulation = await server.simulateTransaction(transaction)
if (rpc.Api.isSimulationRestore(simulation)) {
  const restore = new TransactionBuilder(account, { fee: simulation.minResourceFee, networkPassphrase })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(simulation.transactionData.build())
    .setTimeout(30)
    .build()

  const signedRestore = await wallet.signTransaction(restore.toXDR())
  const submitted = await server.sendTransaction(signedRestore)
  await waitUntilTerminal(server, submitted.hash)

  const freshAccount = await server.getAccount(transaction.source)
  const rebuilt = rebuildOriginal(transaction, freshAccount.sequenceNumber())
  const signedOriginal = await wallet.signTransaction(rebuilt.toXDR())
  await server.sendTransaction(signedOriginal)
}
```

This is deliberately schematic: applications must also handle simulation
errors, wallet rejection, failed or timed-out submissions, fee policy, and
sequence-number changes. The linked RPC methods and SDK operation above are the
raw primitives; the retry and confirmation policy is application code.

## Side-by-side

| Concern | Hand-rolled flow | `@soroban-resurrect/sdk` |
| --- | --- | --- |
| Archive detection | Inspect the simulation response and extract its restore footprint. The RPC response shape is described in [`simulateTransaction`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/simulateTransaction). | `submitWithRestore` simulates and detects archived entries; `needsRestore` supports a separate preflight check. |
| Restore transaction | Build `restoreFootprint`, attach the simulation's transaction data, and sign it using the wallet and network passphrase. See the [Stellar SDK operation](https://stellar.github.io/js-stellar-sdk/Operation.html#.restoreFootprint). | Builds the restore transaction from the simulated footprint and calls the `WalletAdapter` to sign it. |
| Fees | Choose how to use `minResourceFee`, including any margin, cap, and user confirmation. | Applies `restoreFeeMultiplier` and `maxRestoreFeeStroops`; `estimateRestoreCost` lets the app preview the amount before signing. |
| Confirmation and retries | Poll `getTransaction`, implement a timeout, and decide how to recover from `tx_bad_seq` by fetching a fresh account sequence and asking the wallet to sign again. | Polls or uses configured SSE confirmation and retries original submission after `tx_bad_seq` up to `maxSequenceRetries`. The restore and original transactions still require wallet approval. |
| Framework integration | Wire progress, errors, and cleanup into the application's own state and lifecycle. | The core package is framework-neutral. Separate React, Vue, and Svelte hook packages provide framework-specific state integration. |
| Dependencies and bundle | Only the RPC and transaction-building dependencies already used by the app are needed; the application owns the restore code. | The SDK package manifest declares direct runtime dependencies on `@stellar/stellar-sdk`, `@xstate/fsm`, and `@soroban-resurrect/core`. Framework hooks and wallet adapters are separate packages. |
| Abstraction | Full control over every request and policy, in exchange for maintaining the flow and its edge cases. | Less orchestration code and a consistent result/state API, in exchange for using the SDK's flow and configuration. |

The SDK does not remove wallet prompts, pay restore fees on the caller's behalf,
or guarantee that every restore succeeds. Apps remain responsible for presenting
the fee and failure state to users.

## Bundle size

There is no single bundle-size number that applies to every application:
bundlers, import paths, and framework integrations affect the final output. The
repository's checked-in bundle budget file does not currently contain measured
per-entry byte values. To measure a built SDK entry with the repository's
tree-shaking-aware gzip report, run:

```bash
npm run build:sdk
node scripts/check-bundle-budgets.mjs --summary /tmp/soroban-resurrect-bundle.md
```

Compare the entry you actually import, and include any separately installed
framework hook or wallet adapter in your application bundle measurement.

## When you may not need this SDK

If your application has one restore path, already uses Soroban RPC and the
Stellar SDK, and is comfortable owning fee policy, wallet prompts, confirmation
polling, sequence retries, and their tests, a small helper around the raw RPC
flow may be enough. The SDK is more useful when you want the shared recovery
workflow, structured progress/results, retry handling, or a framework hook.

See [Getting Started](/guide/getting-started) for the SDK API and installation
instructions.
