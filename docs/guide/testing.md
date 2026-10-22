# Testing

The SDK talks to the network through a small interface — `ISorobanRpcClient` —
rather than the concrete `rpc.Server` class from `@stellar/stellar-sdk`. That
makes it possible to drive `SorobanResurrect` in tests with a fully
deterministic, in-memory client instead of a real (or even mocked) network
connection.

## `ISorobanRpcClient`

```typescript
interface ISorobanRpcClient {
  simulateTransaction(transaction: Transaction): Promise<rpc.Api.SimulateTransactionResponse>
  sendTransaction(
    transaction: Transaction | FeeBumpTransaction,
  ): Promise<rpc.Api.SendTransactionResponse>
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>
  getAccount(publicKey: string): Promise<Account>
  getLedgerEntries(...keys: xdr.LedgerKey[]): Promise<rpc.Api.GetLedgerEntriesResponse>
  getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse>
}
```

It covers exactly the six RPC methods the SDK uses. Any object — a `vi.fn()` /
`jest.fn()` mock, a hand-written stub, or a real `SorobanRpcClient` — that
implements these six methods can be used wherever the SDK expects an RPC
client, with no casting required.

The SDK property-based suite also generates ContractData and ContractCode
ledger keys, checks that XDR parsing preserves their type and produces
idempotent canonical base64, and verifies that invalid ledger-key
discriminants are rejected. A fixed fast-check seed keeps those cases
reproducible in CI; set `FC_SEED` locally to explore different generated keys.

## Injecting a test double (recommended)

Pass your test double as `config.rpcClient` when constructing `SorobanResurrect`.
This is the supported, tested injection point — the instance uses it for every
RPC call for its whole lifetime, including the full `submitWithRestore`
workflow:

```typescript
import { vi } from 'vitest'
import type { ISorobanRpcClient } from '@soroban-resurrect/sdk'
import { SorobanResurrect } from '@soroban-resurrect/sdk'

function makeMockRpcClient(): ISorobanRpcClient {
  return {
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    getAccount: vi.fn(),
    getLedgerEntries: vi.fn(),
    getLatestLedger: vi.fn(),
  }
}

const mockClient = makeMockRpcClient()
const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org', // still required, but never called
  rpcClient: mockClient,
})

// sdk.server === mockClient
```

> `rpcUrl` is still required by the config type, but when `rpcClient` is
> supplied the SDK never constructs its own `rpc.Server` from it — every call
> goes through `mockClient` instead.

### Post-construction `sdk.server` swap

`sdk.server` is writable, and reading it after a swap does reflect the new
value — but only the facade methods that read `this.server` fresh on every
call (`sendTransaction`, `queryLedgerTTL`, `queryLedgerEntryTTL`,
`getExpiringSoonEntries`) will actually use the swapped client. The full
`submitWithRestore` / `buildRestoreTx` / `retry` workflow is driven by an
internal executor and simulator that capture the RPC client once, at
construction time — swapping `sdk.server` afterwards does **not** redirect
those. Construct the instance with `rpcClient` already set (as above) if you
need the full workflow to run against a test double.

## Restore-then-submit happy-path assertion

A minimal end-to-end assertion — simulate a restore-required response, then a
clean response for the resubmitted original transaction, and assert on the
result:

```typescript
const mockClient = makeMockRpcClient()

vi.mocked(mockClient.simulateTransaction)
  .mockResolvedValueOnce(restoreRequiredResponse) // 1st simulate: restore needed
  .mockResolvedValueOnce(cleanResponse) // 2nd simulate: after restore
vi.mocked(mockClient.sendTransaction)
  .mockResolvedValueOnce({ hash: 'restore-hash' })
  .mockResolvedValueOnce({ hash: 'original-hash' })
vi.mocked(mockClient.getTransaction).mockResolvedValue({
  status: rpc.Api.GetTransactionStatus.SUCCESS,
})
vi.mocked(mockClient.getAccount).mockResolvedValue(someAccount)

const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  rpcClient: mockClient,
})

const result = await sdk.submitWithRestore({ transaction, wallet })

expect(result.success).toBe(true)
expect(result.restoreTxHash).toBe('restore-hash')
expect(result.originalTxHash).toBe('original-hash')
expect(mockClient.simulateTransaction).toHaveBeenCalledTimes(2)
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

## Archived-key detection benchmarks

`detectArchivedEntries` is the hot path for deciding whether a transaction
needs a restore, so its cost must stay predictable as the number of ledger
keys grows. The SDK ships a repeatable benchmark suite that measures both
wall-clock time and heap allocation across representative footprint sizes.

Run it with:

```bash
npm run bench --workspace @soroban-resurrect/sdk
```

Set `BENCH_ITERATIONS` to override the default iteration count when you need a
longer or shorter run locally:

```bash
BENCH_ITERATIONS=5000 npm run bench --workspace @soroban-resurrect/sdk
```

The suite (`src/__benchmarks__/detectArchivedEntries.bench.ts`) drives
`detectArchivedEntries` against a scripted `ISorobanRpcClient` for footprint
sizes of 1, 10, 100, and 1000 keys, mixing active, near-expiry, and archived
entries. For each size it reports:

- **time** — mean and p95 duration per call, in milliseconds;
- **allocation** — mean heap bytes allocated per call, measured with
  `process.memoryUsage().heapUsed` deltas around a forced GC.

### Baseline and growth expectations

Detection is a single `getLedgerEntries` round-trip plus a linear scan of the
returned entries, so both time and allocation should grow **linearly** with the
number of keys. The committed baseline (`src/__benchmarks__/baseline.json`)
records the reference numbers for each footprint size. The benchmark fails when
observed time or allocation exceeds the baseline by more than the configured
`GROWTH_TOLERANCE` (default `2.5x`), which catches accidental quadratic
behavior or per-key allocations without being flaky on shared CI runners.

To refresh the baseline after an intentional change, run the suite with
`BENCH_UPDATE_BASELINE=1` and commit the updated `baseline.json` alongside the
change:

```bash
BENCH_UPDATE_BASELINE=1 npm run bench --workspace @soroban-resurrect/sdk
```

Benchmarks are not part of the default `npm test` run; they execute in the
`bench` CI job so regressions are visible without slowing the unit suite.

## Mutation testing for transaction-safety invariants

Line coverage tells you a test *ran* a line; it does not tell you the test
would *fail* if that line were subtly wrong. For the transaction and
wallet-handling paths — where a silent change could submit an altered amount,
the wrong destination, or skip a required restore — mutation testing is the
stronger signal. The workspace uses Stryker to mutate the SDK's transaction
and wallet modules and reports surviving mutants as a quality gate.
