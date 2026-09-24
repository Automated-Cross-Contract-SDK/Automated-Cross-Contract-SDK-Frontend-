---
pageClass: playground-page
aside: false
title: Playground
---

<script setup>
import Playground from '../.vitepress/components/Playground.vue'
</script>

# Interactive Playground

The docs are a static site, so this page embeds a small in-browser runner instead
of sending you to a testnet. It ships a **fake `ISorobanRpcClient`** with canned
responses and a dependency-free stand-in for `SorobanResurrect` that drives the
**same state machine** as the real SDK: `idle` → `restore_needed` →
`signing_restore` → `submitting_restore` → `confirming_restore` →
`submitting_original` → `signing_original` → `success` (or `error`).

No wallet, no network. Every RPC call and state transition below is simulated
locally in your browser.

<ClientOnly>
  <Playground />
</ClientOnly>

## What you're seeing

The runner injects a handful of globals into the snippet. They mirror the real
package's public surface, so the code you write here is the code you'd write
against `@soroban-resurrect/sdk`:

| Global                                              | Mirrors                                                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SorobanResurrect`                                  | The SDK's facade class — `needsRestore`, `detectArchivedKeys`, `buildRestoreTx`, `submitWithRestore`, `onStateChange`, `state`, `stateInfo`. |
| `createFakeRpcClient(scenario?)`                    | `createRpcClient(rpcUrl)` — but returns a canned client implementing all six `ISorobanRpcClient` methods.                                    |
| `buildSampleTransaction()`                          | An `invokeContractFunction` transaction to feed the workflow.                                                                                |
| `createMockWallet()` / `createDisconnectedWallet()` | A `WalletAdapter` that signs by echoing the XDR (or reports itself as disconnected).                                                         |
| `console`                                           | Captured into the **Console** panel.                                                                                                         |
| `scenario`                                          | The currently selected scenario string.                                                                                                      |

## Scenarios

Use the selector above to change what the fake RPC client returns:

- **Restore needed** — the first simulation reports archived entries, so the SDK
  builds and submits a `restoreFootprint` transaction, waits for confirmation,
  rebuilds the original transaction, then submits it. This is the full CAP-0066 flow.
- **No restore needed** — simulation succeeds immediately; the transaction is
  signed and submitted without any restore step.
- **Simulation error** — simulation fails, so nothing is signed or submitted.
- **Restore fails to confirm** — the restore transaction is submitted but never
  confirms, so the original transaction is never sent.

## Things to try

- Read the **State timeline** and **RPC calls** panels together — they show the
  two `simulateTransaction` calls (original, then rebuilt original) and the two
  `sendTransaction` calls (restore, then original) on the restore-needed path.
- Throw on the rebuild by editing the snippet, and watch the state machine land
  on `error`.
- Call `sr.buildRestoreTx(walletPublicKey, tx)` on the **No restore needed**
  scenario — it throws, because there is nothing to restore.
- Swap `createMockWallet()` for `createDisconnectedWallet()` to see the
  `WALLET_NOT_CONNECTED` path short-circuit before any signing.
- Subscribe with `sr.onStateChange(...)` and render your own progress bar inside
  the snippet.

## Using this in real code

The snippet is a simulation, but the API is real. To run the same flow against a
network (or a deterministic test double), see:

- [RPC Client Injection](/guide/rpc-client-injection) — wrap or replace the RPC
  transport for logging, caching, rate-limiting, or tests.
- [Testing](/guide/testing) — the `config.rpcClient` injection point and the
  canned-response pattern used behind this page.
- [SDK API reference](/api/sdk) — `SorobanResurrect`, `ISorobanRpcClient`, and
  `ResurrectResult`.
