# Getting Started

Soroban-Resurrect solves the "archived ledger entry" problem for Soroban dApps. When a user's persistent data (token balance, loan position, etc.) expires due to TTL rent, their transaction fails with a cryptic error. This SDK automatically detects archived entries via [CAP-0066](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0066.md) and seamlessly restores them before submitting the user's intended transaction.

## Installation

```bash
npm install @soroban-resurrect/sdk @stellar/stellar-sdk
```

If you're building a React dApp, also install the hook package:

```bash
npm install @soroban-resurrect/react-hook
```

`@stellar/stellar-sdk` (`^12.0.0`) and `react` (`^18.0.0`, for the hook package) are peer dependencies — install them alongside the SDK.

## Requirements

- Node.js 20+
- Current and previous major releases of Chrome, Edge, Firefox, and Safari.
  The browser SDK build targets ES2022 and requires `fetch`, `AbortController`,
  `TextEncoder`, and `TextDecoder`; SSE additionally requires a streaming
  `Response.body`. When SSE streaming is unavailable, transaction confirmation
  falls back to RPC polling.
- A Soroban RPC endpoint (Testnet, Futurenet, or Mainnet)
- A wallet that can sign Soroban transaction XDR (Freighter, xBull, or a custom signer)

## Quick Start (Direct SDK)

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { TransactionBuilder, Account, Operation, Networks } from '@stellar/stellar-sdk'

const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
})

// Build the transaction you actually want to submit
const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
  .addOperation(
    Operation.invokeContractFunction({
      contract: 'CCJZ5...K2Q',
      function: 'withdraw',
      args: [nativeToScVal(1000, { type: 'i128' })],
    }),
  )
  .setTimeout(30)
  .build()

// Check up front whether restoration will be needed
const needsRestore = await sr.needsRestore(tx)

// Wrap your wallet in the WalletAdapter shape
const wallet = {
  isConnected: async () => true,
  getPublicKey: async () => freighter.publicKey,
  signTransaction: async (txXdr, opts) => freighter.signTransaction(txXdr, opts),
}

// Submit — restoration (if needed) happens automatically
const result = await sr.submitWithRestore({ transaction: tx, wallet })

if (result.success) {
  console.log('Original tx hash:', result.originalTxHash)
  if (result.restoreTxHash) {
    console.log('Restore tx hash:', result.restoreTxHash)
    console.log('Archived keys restored:', result.archivedKeysDetected)
  }
} else {
  console.error('Failed:', result.error)
}
```

## Quick Start (React)

```tsx
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

function App() {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: 'https://soroban-testnet.stellar.org' }}>
      <WithdrawButton />
    </SorobanResurrectProvider>
  )
}

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()

  const handleWithdraw = async () => {
    const result = await submitWithRestore(tx, wallet)
    // result.success, result.originalTxHash, etc.
  }

  return (
    <button onClick={handleWithdraw} disabled={isProcessing}>
      {isProcessing ? state.message : 'Withdraw'}
    </button>
  )
}
```

## Estimating restore fees and asking for consent

Restoring archived entries is a separate on-chain transaction with its own fee,
so it costs more than the original transaction alone. Estimate it up front with
`estimateRestoreCost` and present the two costs separately before asking the
user to sign:

```typescript
const estimate = await sr.estimateRestoreCost(tx)

if (estimate.requiresRestore) {
  // estimate.originalFee and estimate.restoreFee are stroops (strings)
  console.log('Original tx fee:', estimate.originalFee)
  console.log('Restore fee:', estimate.restoreFee)
  console.log('Total:', estimate.totalFee)
  console.log('Archived keys:', estimate.archivedKeys.length)
}
```

`estimateRestoreCost` returns a stable `RestoreCostEstimate` shape:
`{ requiresRestore, originalFee, restoreFee, totalFee, archivedKeys }`. Fees are
returned as stroop strings to avoid precision loss; format them for display in
your UI. When `requiresRestore` is `false`, `restoreFee` is `'0'` and
`totalFee === originalFee`, so you can render the same component in both cases.

### Consent UX patterns

- **Show both costs.** Always display the original transaction fee and the
  restore fee as distinct line items, plus the total. Never fold the restore fee
  into the original cost silently — users should see why the total is higher.
- **Explain the restore.** A short note ("Your account data expired and must be
  restored before this transaction can run") prevents the fee from looking like
  an unexplained surcharge.
- **Require explicit consent.** Only call `submitWithRestore` after the user
  confirms the estimate. If they decline, do not submit anything.
- **Re-estimate on retry.** Fees can change between attempts; call
  `estimateRestoreCost` again before re-prompting rather than reusing a stale
  estimate.
- **Handle the no-restore path.** If `requiresRestore` is `false`, skip the
  consent step and submit normally.

```tsx
const estimate = await sr.estimateRestoreCost(tx)
if (estimate.requiresRestore && !(await confirmRestoreFee(estimate))) {
  return // user declined — nothing submitted
}
const result = await sr.submitWithRestore({ transaction: tx, wallet })
```

See [Restore fees](/guide/restore-fees) for the full fee model and
[History persistence](/guide/history-persistence) for how restore outcomes are
recorded.

## Choosing an approach

If you already use Soroban RPC and only need a single, application-specific
restore flow, you may prefer to maintain that small flow yourself. See
[Manual restore flow vs. the SDK](/guide/comparison) for the trade-offs,
dependencies, and bundle-size measurement command.

## Cancelling a restore workflow

Pass an `AbortSignal` to cancel further SDK work, including simulation waits,
wallet prompts that honor the signal, and transaction-confirmation polling:

```typescript
const controller = new AbortController()
const result = await sr.submitWithRestore({
  transaction: tx,
  wallet,
  signal: controller.signal,
})

// Call from a cancel button or when the owning view is disposed:
controller.abort()

if (!result.success && result.errorCode === 'ABORTED') {
  // A transaction already submitted may still complete on-chain.
}
```

`AbortSignalOptions` is exported as a stable type. A `{ signal }` options object
is accepted by `simulate`, `detectArchivedKeys`, `detectArchivedKeysBatch`,
`needsRestore`, `estimateRestoreCost`, `buildRestoreTx` (after its optional
simulation response), `buildBatchRestoreTx`, `sendTransaction`, `retry`, and
`restoreKeys`. `submitWithRestore` accepts `signal` in its options object, and
`submitBatchWithRestore(items, { signal })` uses one signal for the whole batch.
Existing calls that omit a signal are unchanged.

## Upgrading between SDK major versions

This SDK follows [semantic versioning](https://semver.org/). Patch and minor
releases are backward compatible; **major** releases may change public APIs,
remove deprecated behavior, or raise peer-dependency floors. This section is the
migration policy and the upgrade path for consumers.

### Migration policy

- **Deprecation before removal.** A public API is marked `@deprecated` (with a
  replacement in the JSDoc) for at least one minor release before it is removed
  in the next major. Deprecated APIs keep working until the major that removes
  them.
- **Documented breaking changes.** Every major release ships a changelog entry
  listing removed/renamed APIs, changed signatures, and new peer-dependency
  requirements.
- **Peer-dependency floors.** A major may raise the minimum
  `@stellar/stellar-sdk` (and `react` for the hook package) version. Check the
  release notes before upgrading.
- **No silent behavior changes.** Changes to restore detection, fee estimation,
  or confirmation semantics are called out explicitly in the changelog.

### Upgrade steps

1. **Read the changelog** for the target major and note every removed or renamed
   API and any peer-dependency bumps.
2. **Bump the peer dependencies first** — upgrade `@stellar/stellar-sdk` (and
   `react` for the hook package) to the versions the new major requires, then
   upgrade `@soroban-resurrect/sdk` and `@soroban-resurrect/react-hook`.
3. **Fix deprecation warnings.** Run your build/tests with deprecation warnings
   enabled and replace each deprecated call with its documented replacement
   before moving to the next major.
4. **Update changed signatures.** Adjust call sites for renamed options, changed
   return shapes, or new required fields flagged in the changelog.
5. **Re-run your test suite** against the new major, including the no-restore
   path and the restore path, before shipping.

### API changes between major versions

| Area | Change | Migration |
| --- | --- | --- |
| Restore cost | `estimateRestoreCost` returns `RestoreCostEstimate` with stroop-string fees | Read `originalFee`/`restoreFee`/`totalFee` as strings; format for display |
| Cancellation | `{ signal }` options object accepted across the SDK | Pass `signal` in the options object; omitting it is unchanged |
| Batch restore | `submitBatchWithRestore(items, { signal })` uses one signal for the batch | Pass a single signal for the whole batch |

Consult the [API Reference](/api/sdk) for the current stable surface of each
method and type.

### Deprecations and replacements

Deprecated APIs are annotated with `@deprecated` in the type definitions and
list their replacement in the JSDoc. When you see a deprecation warning:

- Switch to the documented replacement immediately — deprecated APIs are
  removed in the next major.
- If no replacement is listed, open an issue so the migration path can be
  documented before removal.

### Compatibility notes

- **Runtime.** Node.js 20+ and the browser targets listed under
  [Requirements](#requirements) apply to all supported majors.
- **Peer dependencies.** Keep `@stellar/stellar-sdk` and `react` within the
  ranges declared by the installed major; mismatches surface as peer-dependency
  warnings at install time.
- **Rollback.** If a major breaks your integration, pin the previous major and
  file an issue describing the regression before upgrading again.

## Next Steps

- Walk through common patterns in the [Tutorial](/guide/tutorial)
- Browse the full [API Reference](/api/sdk)
- See [runnable Examples](/examples/)
- Wire the SDK into your framework via the [Integration Guides](/integrations/react)
