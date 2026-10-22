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

## Coverage gates

The SDK's test command enforces explicit branch and line-coverage floors for three critical restore
modules. The current floors reflect the measured baseline and prevent regressions while coverage
grows:

| Behavior                         | Module                            |
