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

## Mutation testing for transaction-safety invariants

Line coverage tells you a test *ran* a line; it does not tell you the test
would *fail* if that line were subtly wrong. For the transaction and
wallet-handling paths — where a silent change could submit an altered amount,
the wrong destination, or an unsigned envelope — we run mutation testing with
[Stryker](https://stryker-mutator.io/) scoped to those modules only.

### Configuration

Mutation testing is configured in `stryker.config.json` at the repo root. The
interface is stable and documented here so maintainers can run it
reproducibly:

| Setting        | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `mutate`       | `src/transaction/**/*.ts`, `src/wallet/**/*.ts` (excluding `*.test.ts`) |
| `testRunner`   | `vitest`                                                              |
| `mutators`     | `ArithmeticOperator`, `ConditionalExpression`, `EqualityOperator`, `LogicalOperator`, `BlockStatement`, `StringLiteral` |
| `thresholds`   | `high: 90`, `low: 80`, `break: 80`                                    |
| `timeoutMS`    | `30000`                                                               |
| `concurrency`  | `4`                                                                   |
| `reporters`    | `clear-text`, `progress`, `html`, `json`                              |

Only the transaction and wallet modules are mutated — the rest of the
codebase is out of scope, keeping runs fast and focused on the invariants
that matter for safety.

### Running

```bash
npm run test:mutation
```

This runs Stryker against the configured targets using the existing Vitest
suite. The run fails (non-zero exit) when the mutation score drops below the
`break` threshold, so it can gate CI.

### Interpreting surviving mutants

A **surviving mutant** is a change to the source that no test caught. For the
transaction-safety targets, treat every survivor as a potential gap:

- **Altered amount / destination** — a survivor in amount or address handling
  means a test does not assert the exact value submitted. Add an assertion on
  the built envelope (amount, destination, memo) rather than only on success.
- **Unsafe submission** — a survivor around signing or send guards means a
  test does not prove an unsigned or unconfirmed transaction is rejected. Add
  a negative test that asserts `sendTransaction` was *not* called.
- **Boundary conditions** — survivors on comparisons (e.g. fee/ledger bounds)
  usually mean an off-by-one boundary is untested. Add cases at the exact
  boundary and one past it.

Kill survivors by tightening assertions, not by adding `// Stryker disable`
comments. Only disable a mutator for genuinely equivalent mutants, and add a
comment explaining why.

### Compatibility notes

- Mutation testing is a dev-only tool; it adds no runtime dependency and does
  not affect published packages.
- The `break` threshold starts at the measured baseline. Raise it as survivors
  are killed; do not lower it to make a run pass.
- Stryker requires the Vitest suite to pass first — fix failing tests before
  interpreting mutation results.

## Coverage gates

The SDK's test command enforces explicit branch and line-coverage floors for three critical restore
modules. The current floors reflect the measured baseline and prevent regressions while coverage
grows:

| Behavior                         | Module                            
