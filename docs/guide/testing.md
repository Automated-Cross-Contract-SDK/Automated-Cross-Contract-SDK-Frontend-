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

## Boundary and failure cases

- **Errors propagate.** If the underlying transport rejects, the wrapper rethrows the same error after invoking `onError`. Tests should assert that failures surface to the caller unchanged.
- **Hooks are optional.** Omitting `onRequest`/`onResponse`/`onError` leaves the transport untouched.
- **Ordering.** `onRequest` fires before the transport call; `onResponse` or `onError` fires after it settles.

## Compatibility

`createRpcClient` is additive. Existing code that passes a transport directly to `createSdk` continues to work; wrapping is opt-in and requires no migration. The wrapper preserves the transport interface, so any custom transport you already use can be wrapped as-is.
