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

## Request coalescing for ledger reads

Identical in-flight ledger reads are coalesced within a safe request scope so
concurrent callers share a single underlying `getLedgerEntries` call. This is
exposed through a documented, stable helper in the SDK package:

```typescript
import { coalesceLedgerReads } from '@soroban-resurrect/sdk'

// Within one scope, identical keys share a single read.
const scope = coalesceLedgerReads(mockClient)
const [a, b] = await Promise.all([
  scope.getLedgerEntries(keyA, keyB),
  scope.getLedgerEntries(keyA, keyB),
])
// mockClient.getLedgerEntries was called exactly once
```

Coalescing is keyed on the canonical base64 of the requested ledger keys, so
callers that pass the same keys in a different order still share the read.
Scopes are explicit: create a new scope per logical request (e.g. per
`submitWithRestore` call) rather than sharing one across unrelated requests.

Failures do not poison later calls. If the underlying read rejects, the
in-flight entry is evicted, so a subsequent call in the same scope retries the
underlying read instead of replaying the earlier rejection:

```typescript
vi.mocked(mockClient.getLedgerEntries)
  .mockRejectedValueOnce(new Error('network'))
  .mockResolvedValueOnce(okResponse)

const scope = coalesceLedgerReads(mockClient)
await expect(scope.getLedgerEntries(keyA)).rejects.toThrow('network')
await expect(scope.getLedgerEntries(keyA)).resolves.toEqual(okResponse)
expect(mockClient.getLedgerEntries).toHaveBeenCalledTimes(2)
```

Tests should cover the shared-read path (one underlying call for concurrent
identical reads), the key-order-insensitive dedupe, and the failure-eviction
boundary above.

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
wall-clock time and heap allocati

/* … truncated 2238 chars — edit only what you need near the top … */
