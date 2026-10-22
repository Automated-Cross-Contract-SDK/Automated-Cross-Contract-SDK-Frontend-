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

### Success path

```ts
harness.script('getBalance', { lamports: 42 })

const balance = await sdk.getBalance('SomeAddress')
expect(balance).toEqual({ lamports: 42 })
expect(harness.calls).toEqual([
  { method: 'getBalance', params: ['SomeAddress'] },
])
```

### Failure path

Scripted errors surface to the caller unchanged, matching real transport behavior.

```tsnharness.script('getBalance', new Error('rpc unavailable'))

await expect(sdk.getBalance('SomeAddress')).rejects.toThrow('rpc unavailable')
```

### Restore path

Restore flows issue several RPC calls in sequence. Script each step and assert the final state; `reset()` keeps scenarios isolated.

```ts
harness.script('getAccountInfo', { owner: 'program', data: restoredData })
harness.script('sendTransaction', { signature: 'sig-1' })

const result = await sdk.restore({ account: 'SomeAddress' })
expect(result.signature).toBe('sig-1')
expect(harness.calls.map((c) => c.method)).toEqual([
  'getAccountInfo',
  'sendTransaction',
])

harness.reset()
```

### Boundary cases

- **Unscripted methods** reject with a descriptive error so missing fixtures fail loudly instead of silently returning `undefined`.
- **Scripted errors** are rethrown unchanged, so `try/catch` and `rejects` assertions behave as they would against a live transport.
- **Isolation** — call `harness.reset()` between tests to clear recorded calls and any remaining scripted responses.

## Boundary and failure cases

- **Errors propagate.** If the underlying transport rejects, the wrapper rethrows the same error after invoking `onError`. Tests should assert that failures surface to the caller unchanged.
- **Hooks are optional.** Omitting `onRequest`/`onResponse`/`onError` leaves the transport untouched.
- **Ordering.** `onRequest` fires before the transport call; `onResponse` or `onError` fires after it settles.

## Compatibility

`createRpcClient` is additive. Existing code that passes a transport directly to `createSdk` continues to work; wrapping is opt-in and requires no migration. The wrapper preserves the transport interface, so any custom transport you already use can be wrapped as-is.

`createMockRpcHarness` is also additive and built on `createRpcClient`, so no migration is required. Existing tests that hand-roll a mock transport keep working; the harness is an opt-in convenience for wallet-free success, failure, and restore scenarios.
