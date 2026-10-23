# Production Deployment Guide

This guide covers the practices we recommend before shipping a Soroban dApp
that uses `@soroban-resurrect/sdk` to production. It walks through network
selection, wallet integration, error handling, transaction UX, monitoring, and
safe rollout. For a first integration, start with
[Getting Started](/guide/getting-started) and the [Tutorial](/guide/tutorial).

## Network selection

Pick the network explicitly and never infer it from the RPC URL. The SDK uses
`networkPassphrase` to build and validate transactions, so a mismatch between
the passphrase and the RPC endpoint produces signatures that the network will
reject.

```typescript
import { Networks } from '@stellar/stellar-sdk'
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-mainnet.stellar.org',
  networkPassphrase: Networks.PUBLIC,
})
```

| Environment | `networkPassphrase` | Typical RPC URL |
| --- | --- | --- |
| Mainnet | `Networks.PUBLIC` | `https://soroban-mainnet.stellar.org` |
| Testnet | `Networks.TESTNET` | `https://soroban-testnet.stellar.org` |
| Futurenet | `Networks.FUTURENET` | `https://rpc-futurenet.stellar.org` |

Recommendations:

- **Mainnet** for real value. Treat every restore as a real transaction with a
  real fee.
- **Testnet** for staging and integration tests. It is periodically reset, so
  never persist state you expect to survive.
- **Futurenet** for previewing protocol changes. It is unstable and not for
  user-facing traffic.

Drive the configuration from environment variables so the same build can be
promoted from testnet to mainnet without code changes:

```typescript
const network = process.env.STELLAR_NETWORK ?? 'testnet'
const config = {
  testnet: { rpcUrl: 'https://soroban-testnet.stellar.org', networkPassphrase: Networks.TESTNET },
  futurenet: { rpcUrl: 'https://rpc-futurenet.stellar.org', networkPassphrase: Networks.FUTURENET },
  mainnet: { rpcUrl: 'https://soroban-mainnet.stellar.org', networkPassphrase: Networks.PUBLIC },
}[network]
```

## Wallet integration

The SDK talks to wallets through the `WalletAdapter` shape. Wrap your wallet
provider once and reuse the adapter everywhere:

```typescript
import type { WalletAdapter } from '@soroban-resurrect/sdk'

const wallet: WalletAdapter = {
  isConnected: async () => freighter.isConnected(),
  getPublicKey: async () => freighter.getPublicKey(),
  signTransaction: async (txXdr, opts) => freighter.signTransaction(txXdr, opts),
}
```

Production checklist:

- **Verify the network in the wallet.** Freighter and xBull expose the active
  network; refuse to sign if it does not match your configured passphrase.
- **Handle user rejection.** A declined signature surfaces as a failed result;
  do not retry automatically.
- **Re-read the public key** before each submission. Users can switch accounts
  mid-session.
- **Never log signed XDR or secrets.** Treat transaction envelopes as sensitive.

## Error handling

`submitWithRestore` returns a discriminated result rather than throwing for
expected failures. Branch on `errorCode` instead of parsing messages:

```typescript
const result = await sr.submitWithRestore({ transaction: tx, wallet })

if (!result.success) {
  switch (result.errorCode) {
    case 'ABORTED':
      // User cancelled; a submitted tx may still land on-chain.
      break
    case 'WALLET_REJECTED':
      // Show a neutral "signature declined" message.
      break
    case 'INSUFFICIENT_FEE':
      // Surface a retry with a higher fee.
      break
    default:
      // Log with context and show a generic failure message.
      reportError(result.error)
  }
}
```

Guidelines:

- Distinguish **retryable** failures (fee too low, transient RPC errors) from
  **terminal** ones (rejected signature, invalid arguments).
- Always inspect `result.originalTxHash` and `result.restoreTxHash` before
  retrying — a restore may have succeeded even when the original transaction
  failed.
- Wrap unexpected exceptions in a top-level handler so a single failure cannot
  leave the UI in a loading state.

## Transaction UX

Restoration can involve two transactions (restore, then the original). Keep the
user informed:

- **Show progress states.** The React hook exposes `state.message` and
  `isProcessing`; render them so users know a restore is in flight.
- **Explain the extra step.** When `result.restoreTxHash` is present, tell the
  user their data was restored and the original action completed.
- **Offer cancellation.** Pass an `AbortSignal` and wire it to a cancel button;
  see [Cancelling a restore workflow](/guide/getting-started#cancelling-a-restore-workflow).
- **Disable double submits.** Guard the submit button with `isProcessing` to
  avoid duplicate transactions.
- **Link to the explorer.** Show both hashes so users can verify on-chain.

## Monitoring

Instrument the SDK so you can see restore rates and failures in production:

- **Track outcomes.** Emit a metric per submission tagged with `success`,
  `errorCode`, and whether a restore was needed (`restoreTxHash` present).
- **Watch restore frequency.** A rising restore rate can signal TTL settings
  that are too short for your contracts.
- **Alert on error spikes.** Sudden increases in `INSUFFICIENT_FEE` or RPC
  errors usually indicate network congestion or an endpoint problem.
- **Log RPC latency.** The SDK's RPC calls are the main source of latency;
  measure them to catch slow endpoints early.
- **Never log XDR or keys.** Metrics and logs should carry hashes and codes
  only.

## Safe rollout

- **Stage on testnet first.** Run the full flow — including a forced restore —
  against testnet before promoting.
- **Canary on mainnet.** Roll out to a small percentage of users and watch the
  restore rate and error codes before a full release.
- **Pin SDK versions.** Lock `@soroban-resurrect/sdk` and
  `@stellar/stellar-sdk` to known-good versions and upgrade deliberately.
- **Keep a kill switch.** Gate the restore flow behind a feature flag so you can
  fall back to a manual flow if something goes wrong.
- **Have a rollback plan.** Know how to revert the deployment and which
  transactions may already be in flight.

## Compatibility and migration notes

- **Network passphrase changes.** Futurenet and testnet can change their
  passphrase or reset state. Re-read the passphrase from configuration on each
  deploy rather than hard-coding it in the bundle.
- **SDK versions.** `@soroban-resurrect/sdk` requires `@stellar/stellar-sdk`
  `^12.0.0`. Check the [API Reference](/api/sdk) for the stable interface and
  any breaking changes before upgrading.
- **Browser support.** The SDK targets ES2022 and requires `fetch`,
  `AbortController`, `TextEncoder`, and `TextDecoder`. SSE confirmation needs a
  streaming `Response.body`; without it the SDK falls back to RPC polling.
- **Cancellation semantics.** Aborting stops further SDK work but cannot undo a
  submitted transaction. Inspect the returned hash before retrying.

## Next Steps

- Review the full [API Reference](/api/sdk)
- Compare against a [manual restore flow](/guide/comparison)
- See [runnable Examples](/examples/)
