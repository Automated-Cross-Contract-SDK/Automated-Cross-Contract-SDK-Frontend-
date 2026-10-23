# Vue Hook (`@soroban-resurrect/vue-hook`)

## `useSorobanResurrect(config)` composable

Creates and manages a `SorobanResurrect` instance scoped to the calling
component. Accepts a ref, getter, or plain `SorobanResurrectConfig`; recreates
the SDK when the config changes and disposes the instance and SDK subscriptions
when the active Vue effect scope ends. It also works in a manually-created
`effectScope()`. Use it when a component needs its own instance.

Wallet cancellation resolves with the SDK's failed `ResurrectResult` rather
than throwing; the same result is stored in `lastResult`. The state listener is
removed when the component unmounts.

```ts
const { state, isProcessing, submitWithRestore, reset, cancel } = useSorobanResurrect(config)

const pending = submitWithRestore(transaction, wallet)
cancel() // stops active local workflows; already-submitted on-chain transactions cannot be undone
const result = await pending // cancellation is returned as a failed ResurrectResult
```

`cancel()` aborts all active `submitWithRestore` calls and is safe when no call
is active. Cancellation prevents subsequent SDK workflow steps, but cannot
reverse a transaction already submitted to the network or dismiss a wallet
prompt that the wallet adapter does not support aborting.

## `SorobanResurrectPlugin` — shared instance via `app.use()`

Install the plugin to construct **one** `SorobanResurrect` instance and provide
it to the whole app, so components consume it with `injectSorobanResurrect()` —
no manual `provide` / `inject` wiring. The instance is disposed when the app is
unmounted.

Composables that receive an existing `resurrect` instance do not take ownership
of it. When given `config`, they create and dispose their own instance as the
effect scope changes or ends. Watcher polling intervals and pending poll
results are also stopped with that scope. `on()` returns an unsubscribe
function, and any subscriptions not manually removed are automatically
unsubscribed when the scope ends. `useSorobanResurrectWatcher` auto-starts on
component mount; when used in a manually-created effect scope, call `start()`
explicitly.

```ts
import { createApp } from 'vue'
import { SorobanResurrectPlugin } from '@soroban-resurrect/vue-hook'
import App from './App.vue'

createApp(App)
  .use(SorobanResurrectPlugin, {
    config: { rpcUrl: 'https://soroban-testnet.stellar.org' },
  })
  .mount('#app')
```

```vue
<script setup lang="ts">
import { injectSorobanResurrect } from '@soroban-resurrect/vue-hook'

const resurrect = injectSorobanResurrect()

async function submit(transaction, wallet) {
  return resurrect.submitWithRestore({ transaction, wallet })
}
</script>
```

### API

| Export                          | Description                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `SorobanResurrectPlugin`        | Vue plugin. `app.use(SorobanResurrectPlugin, { config })`. Throws if `config` is missing.             |
| `injectSorobanResurrect()`      | Returns the shared `SorobanResurrect`. Must run in `setup()`. Throws if the plugin was not installed. |
| `SOROBAN_RESURRECT_KEY`         | The `InjectionKey` used internally — for advanced/SSR wiring.                                         |
| `SorobanResurrectPluginOptions` | `{ config: SorobanResurrectConfig }`.                                                                 |

## Example application: wallet connection flow

A complete Vue example lives in `examples/vue-wallet`. It wires the composable
to a wallet connection and renders every UI state the flow can produce:

| State            | Trigger                                                       | UI shown                                              |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `idle`           | Initial render                                                | Connect wallet button                                 |
| `loading`        | Wallet connect / restore in progress                          | Spinner + disabled controls                           |
| `rejected`       | User dismisses the wallet prompt                              | Rejection notice with a retry action                  |
| `restored`       | A previously submitted transaction is restored                | Success banner with the restored transaction hash     |
| `failed`         | Wallet or RPC error, or a failed `ResurrectResult`            | Error message with the failure reason and retry       |

The example exposes a single stable interface, `useWalletConnection`, so the
flow can be reused and tested independently of the UI:

```ts
import { useWalletConnection } from './useWalletConnection'

const {
  status, // Ref<'idle' | 'loading' | 'rejected' | 'restored' | 'failed'>
  error, // Ref<string | null>
  result, // Ref<ResurrectResult | null>
  connect, // (wallet) => Promise<void>
  retry, // () => Promise<void>
  reset, // () => void
} = useWalletConnection({ resurrect })
```

`connect(wallet)` sets `status` to `loading`, then resolves to `restored` when
the SDK returns a successful `ResurrectResult`, `rejected` when the wallet
cancels, and `failed` (with `error` populated) on any thrown error. `retry()`
re-runs the last `connect` call; `reset()` returns to `idle` and clears
`error`/`result`.

### Tests

The example ships with Vitest tests (`examples/vue-wallet/useWalletConnection.spec.ts`)
covering the expected path plus boundary and failure cases:

- successful connect transitions `idle → loading → restored`
- wallet rejection resolves to `rejected` without throwing
- a thrown wallet/RPC error resolves to `failed` and populates `error`
- `retry()` after a failure re-enters `loading` and can succeed
- `reset()` clears `error` and `result` back to `idle`
- calling `connect()` while already `loading` is a no-op (boundary)

### Compatibility

The example targets Vue 3 (`>=3.3`) and the same `@soroban-resurrect/vue-hook`
version as the rest of the monorepo. No migration is required for existing
consumers — `useWalletConnection` is example-local and not exported from the
published package.
