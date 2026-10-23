# Troubleshooting Guide

This guide maps each **public error category** surfaced by the SDK and wallet
middleware to its likely causes, safe recovery steps, and links to the
relevant RPC or wallet diagnostics.

> **Stable interface.** The `category` field on every thrown error is part of
the public API. Categories are stable strings — new categories may be added in
minor releases, but existing category names will not be renamed or removed
without a major version bump. Always branch on `error.category`, not on the
human-readable `message`.

```ts
import { ResurrectError } from '@soroban-resurrect/sdk'

try {
  await resurrect.restore(contractId)
} catch (err) {
  if (err instanceof ResurrectError) {
    switch (err.category) {
      case 'RPC_UNAVAILABLE':
      case 'RPC_TIMEOUT':
        // safe to retry with backoff
        break
      case 'INSUFFICIENT_FEE':
        // surface to the user; do not auto-retry
        break
      default:
        // log and surface a generic message
        break
    }
  }
}
```

## Error categories

### `RPC_UNAVAILABLE`

- **Likely causes:** the configured Soroban RPC endpoint is down, unreachable,
  or returning 5xx responses; a misconfigured `rpcUrl`.
- **Safe recovery:** retry with exponential backoff; fall back to a secondary
  RPC endpoint if configured. No on-chain state is mutated by a failed read.
- **Diagnostics:** verify the endpoint with `curl <rpcUrl>/health` and check the
  [RPC reference](https://developers.stellar.org/docs/data/rpc).

### `RPC_TIMEOUT`

- **Likely causes:** slow network, an overloaded RPC node, or a transaction
  simulation that exceeded the configured timeout.
- **Safe recovery:** retry with backoff; increase the timeout for known-slow
  networks. Restores are idempotent, so a retry is safe.
- **Diagnostics:** inspect `error.cause` for the underlying request; see the
  [RPC reference](https://developers.stellar.org/docs/data/rpc).

### `INSUFFICIENT_FEE`

- **Likely causes:** the source account cannot cover the restore fee plus the
  network base fee; fee bump not applied.
- **Safe recovery:** fund the source account or raise the fee; do **not**
  auto-retry — surface the shortfall to the user. See
  [Restore Fees and Limits](/guide/restore-fees).
- **Diagnostics:** check the account balance via Horizon
  (`/accounts/{id}`) and the fee estimate returned in `error.details`.

### `SIMULATION_FAILED`

- **Likely causes:** the contract invocation failed during simulation — wrong
  arguments, missing authorization, or a contract-level panic.
- **Safe recovery:** inspect `error.details.diagnosticEvents`; fix the call and
  retry. No state is changed by a failed simulation.
- **Diagnostics:** re-run the call in the
  [Interactive Playground](/examples/playground) to reproduce.

### `WALLET_NOT_CONNECTED`

- **Likely causes:** no wallet adapter is connected, or the connection was
  dropped between signing steps.
- **Safe recovery:** prompt the user to reconnect the wallet, then retry the
  restore. See [Adapters and Wallets](/integrations/adapters-and-wallets).
- **Diagnostics:** check the adapter's `isConnected` state before signing.

### `WALLET_REJECTED`

- **Likely causes:** the user declined the signing request in their wallet.
- **Safe recovery:** do not auto-retry; let the user re-initiate the action.
- **Diagnostics:** none required — this is an expected user action.

### `INVALID_ARGUMENT`

- **Likely causes:** a malformed contract ID, key, or option passed to the SDK.
- **Safe recovery:** validate inputs before calling; this is a programming
  error and will not succeed on retry.
- **Diagnostics:** see the [SDK API reference](/api/sdk) for expected shapes.

### `UNKNOWN`

- **Likely causes:** an unexpected failure not yet mapped to a category.
- **Safe recovery:** log `error.cause` and report it; do not auto-retry blindly.
- **Diagnostics:** open an issue with the captured `error.cause`.

## Compatibility and migration notes

- Error categories were introduced as a stable public interface. If you were
  previously matching on `error.message` strings, migrate to `error.category`
  (see the snippet above). Message text is **not** stable and may change.
- New categories may be added in minor releases. Use a `default` branch so
  unknown categories degrade gracefully rather than throwing.
- The `details` and `cause` fields are best-effort diagnostics and may be
  absent; guard access to them.
