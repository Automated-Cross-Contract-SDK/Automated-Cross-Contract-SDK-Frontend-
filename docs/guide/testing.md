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
with no network access.

## Free functions

Lower-level functions such as `executeWithRestore`, `waitForTransaction`, and
`detectArchivedEntries` accept an `ISorobanRpcClient` directly as their
`server` parameter, so the same test doubles work at that level too if you're
testing below the `SorobanResurrect` facade.

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
- `scenarios` — ready-made scripts: `noRestore`, `restore`,
  `restoreSimulationError`, `badSequence`, `slowConfirmation`.

Add it as a dev dependency of the workspace you are testing:

```json
{ "devDependencies": { "@soroban-resurrect/testing": "0.0.0" } }
```

### Walkthrough: archive detected → restore → resubmit

```typescript
import { describe, it, expect } from 'vitest'
import { Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { createMockRpcClient, fixtures, scenarios } from '@soroban-resurrect/testing'

const signer = Keypair.random()
const wallet = {
  isConnected: async () => true,
  getPublicKey: async () => signer.publicKey(),
  signTransaction: async (xdr: string) => xdr,
}

function makeTx() {
  return new TransactionBuilder(fixtures.account(signer.publicKey()), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
}

describe('restore flow', () => {
  it('detects, restores, confirms and resubmits', async () => {
    // 1. Script the network: the first simulation reports an archived
    //    footprint, the re-simulation after the restore succeeds.
    const rpcClient = createMockRpcClient(scenarios.restore())

    const sr = new SorobanResurrect({
      rpcUrl: 'http://mock',
      networkPassphrase: Networks.TESTNET,
      rpcClient,
      pollIntervalMs: 1,
    })

    // 2. Detect: the restore preamble surfaces the archived keys.
    const archived = await sr.detectArchivedKeys(makeTx())
    expect(archived.length).toBeGreaterThan(0)

    // 3. Restore + resubmit in one call.
    const result = await sr.submitWithRestore({ transaction: makeTx(), wallet })
    expect(result).toBeDefined()

    // 4. Assert the RPC choreography: restore tx sent and confirmed,
    //    then the original re-simulated and resubmitted.
    expect(rpcClient.calls.filter((c) => c === 'sendTransaction')).toHaveLength(2)
    expect(rpcClient.calls).toContain('getTransaction')
  })

  it('surfaces a restore simulation error', async () => {
    const rpcClient = createMockRpcClient(scenarios.restoreSimulationError())
    const sr = new SorobanResurrect({
      rpcUrl: 'http://mock',
      networkPassphrase: Networks.TESTNET,
      rpcClient,
    })
    await expect(sr.submitWithRestore({ transaction: makeTx(), wallet })).rejects.toThrow()
  })

  it('reports tx_bad_seq on resubmission', async () => {
    const rpcClient = createMockRpcClient(scenarios.badSequence())
    const sr = new SorobanResurrect({
      rpcUrl: 'http://mock',
      networkPassphrase: Networks.TESTNET,
      rpcClient,
      pollIntervalMs: 1,
    })
    await expect(sr.submitWithRestore({ transaction: makeTx(), wallet })).rejects.toThrow()
  })
})
```

Omitting `serverURL` from the script (the default) makes confirmation fall
back to polling, so no SSE server is needed. Pass `serverURL` only when you
also stub `EventSource`.

### Migrating an existing ad-hoc stub

Replace the hand-written object with `createMockRpcClient({ ... })`, moving
each `mockResolvedValueOnce` chain into the matching `simulate` / `send` /
`getTransaction` array. The response objects are the same shapes, so test
behaviour does not change.
