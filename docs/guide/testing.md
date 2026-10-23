# Testing

This guide covers how to test code that talks to the RPC transport. The SDK exposes a small, stable seam — `createRpcClient` — that lets you wrap the transport for logging, proxying, or mocking without changing the rest of your SDK workflow.

## Wrapping the RPC transport

`createRpcClient` accepts a base transport and returns a wrapped client that implements the same interface. Every SDK call that goes through the transport will pass through your wrapper, so you can observe or intercept requests without touching call sites.

```ts
import { createRpcClient, createSdk } from '@your-sdk/core'

// A logging wrapper around the real transport.
const loggingClient = createRpcClient({
  transport: realTransport,
  onRequest: (method, params) => {
    console.log('[rpc]', method, params)
  },
  onResponse: (method, result) => {
    console.log('[rpc:ok]', method, result)
  },
  onError: (method, error) => {
    console.error('[rpc:err]', method, error)
  },
})

const sdk = createSdk({ rpc: loggingClient })
```

The wrapper is transparent: return values and thrown errors are forwarded unchanged, so existing SDK behavior is preserved.

## Mocking for tests

For unit tests, provide a `transport` that resolves canned responses. The wrapper still applies your hooks, which makes it easy to assert on the calls your code makes.

```ts
import { createRpcClient } from '@your-sdk/core'

const calls: Array<{ method: string; params: unknown }> = []

const mockClient = createRpcClient({
  transport: {
    async request(method, params) {
      calls.push({ method, params })
      if (method === 'getBalance') return { lamports: 42 }
      throw new Error(`unexpected method: ${method}`)
    },
  },
})

// ...exercise your code with mockClient, then assert on `calls`.
```

## Wallet-free example with the mock RPC harness

The mock RPC harness lets you exercise success, failure, and restore flows without a live network or a wallet extension. It is the same `createRpcClient` seam described above, pre-wired with a scripted transport so you can drive each scenario deterministically.

```ts
import { createMockRpcHarness, createSdk } from '@your-sdk/core'

// The harness exposes a stable interface:
//   harness.client   — an RPC client to pass to createSdk
//   harness.calls    — recorded { method, params } requests
//   harness.script   — queue of canned responses / errors per method
//   harness.reset()  — clear calls and script between tests
const harness = createMockRpcHarness()
const sdk = createSdk({ rpc: harness.client })
```

This pattern — two `simulateTransaction` responses (restore-required, then
clean) plus two `sendTransaction` responses (restore, then original) — is
enough to drive the entire state machine (`restore_needed` →
`signing_restore` → `submitting_restore` → `confirming_restore` →
`signing_original` → `submitting_original` → `success`) deterministically,
with no network access. A full workflow test should also verify that rebuilding
preserves the original operations and that each submitted envelope matches the
XDR returned by its corresponding wallet-signing call.

Wallet-rejection integration tests should cover both signing prompts
separately: rejecting the restore signature must send neither transaction,
while rejecting the rebuilt original signature may send the confirmed restore
transaction but must never send the unsigned original transaction.

## Simulation serialization cache

Simulation reuses a cached serialized transaction envelope when the inputs
have not changed, avoiding repeated XDR serialization on the hot path. The
cache is keyed on the transaction's serialized identity (envelope XDR plus
network passphrase); any change to the transaction — new operations, updated
sequence number, different fee, or a different network passphrase — produces a
different key and therefore a fresh serialization. Tests should assert both
directions:

- **Reuse:** simulating the same unchanged transaction twice serializes the
  envelope once (the second simulate hits the cache).
- **Invalidation:** mutating the transaction (e.g. bumping the sequence number
  or adding an operation) or changing the network passphrase causes the next
  simulate to re-serialize rather than reuse a stale representation.

Because the cache is keyed on the serialized envelope itself, a reused entry is
byte-for-byte identical to a freshly serialized one — there is no behavioral
difference, only fewer serialization calls. This is a transparent optimization
with no API or wire-format change, so no migration is required.

## Free functions

Lower-level functions such as `executeWithRestore`, `waitForTransaction`, and
`detectArchivedEntries` accept an `ISorobanRpcClient` directly as their
`server` parameter, so the same test doubles work at that level too if you're
testing below the `SorobanResurrect` facade.

The SDK's `src/__tests__/fixtures/soroban-rpc/v1.ts` fixture set covers success,
restore-required, error, malformed, and extended simulation response shapes.
Keep representative RPC shape changes in a new fixture version and exercise
them through the response guards and extraction helpers.

To verify published package files rather than workspace links, first build the
packages and then run `npm run test:packed-exports`. It packs each package with
an `exports` map, installs the tarballs in a temporary clean project, smoke
tests every declared runtime export, checks declaration imports with TypeScript,
and verifies required peer dependencies resolve.

See also: [API Reference](/api/sdk), [`SorobanResurrectConfig`](/api/types#sorobanresurrectconfig).

## Shared mock-RPC harness

Instead of hand-rolling a stub per test, use the workspace-only
`@soroban-resurrect/testing` package (`packages/testing`). It is marked
`private`, so it is never published and never appears in an SDK tarball.

It exports:

- `createMockRpcClient(script)` — a scripted `ISorobanRpcClient`. Each of
  `simulate`, `send` and `getTransaction` takes one response or an array of
  responses returned in order (the last one repeats). `calls` records every RPC
  call and `sent` every submitted envelope.
- `fixtures` — canned responses: `simulateSuccess`, `simulateRestore`,
  `simulateError`, `sendPending`, `sendError('txBadSeq' | ...)`, `txSuccess`,
  `txFailed`, `txNotFound`, `archivedKey`, `account`.
- `ledgerEntryFixture(status, seed?, currentLedger?)` — deterministic
  `getLedgerEntries` responses for `active`, `near-expiry`, `archived`,
  `missing`, and `unsupported` ledger keys. Each fixture includes its key,
  current ledger, and typed RPC response; `missing` omits the key, while
  `archived` returns an entry whose live-until ledger has passed.
- `scenarios` — ready-made scripts: `noRestore`, `restore`,
  `restoreSimulationError`, `badSequence`, `slowConfirmation`.

Add it as a dev dependency of the workspace you are testing:

```json
{ "devDependencies": { "@soroban-resurrect/testing": "0.0.0" } }
```

## Mock wallet adapter

Integration tests that exercise the signing steps need a wallet, not just an
RPC client. `@soroban-resurrect/testing` also exports a reusable mock wallet
adapter so you don't have to hand-roll one per suite.

| Behavior                         | Module                            |
