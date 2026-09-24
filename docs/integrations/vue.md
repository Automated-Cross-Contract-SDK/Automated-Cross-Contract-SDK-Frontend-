# Vue Integration

The `@soroban-resurrect/vue-hook` package targets Vue 3 and offers two ways in: the `useSorobanResurrect` composable, which owns an SDK instance scoped to the component, and the `SorobanResurrectPlugin` (`app.use`), which builds one shared instance for the whole app.

The repository's [`examples/vue`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/vue) app wires both paths up to a real wallet — use it as a reference implementation.

## Setup

```bash
npm install @soroban-resurrect/sdk @soroban-resurrect/vue-hook @stellar/stellar-sdk
```

## Composable

```vue
<script setup lang="ts">
import { useSorobanResurrect } from '@soroban-resurrect/vue-hook'

const { state, isProcessing, submitWithRestore } = useSorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
})

async function withdraw(tx: Transaction, wallet: WalletAdapter) {
  const result = await submitWithRestore(tx, wallet)
  if (!result.success) console.error(result.error)
}
</script>

<template>
  <button :disabled="isProcessing" @click="withdraw(tx, wallet)">
    {{ isProcessing ? state.message : 'Withdraw' }}
  </button>
</template>
```

The config argument is a `MaybeRefOrGetter`, so passing a getter (for example `() => props.config`) makes the instance follow a reactive config: changing it re-creates the SDK and resets `state` to `idle`. The workflow state is exposed as refs — `state`, `isProcessing`, `isSuccess`, `isError`, `isIdle` — so the template re-renders without any manual `onStateChange` subscription, and cleanup on unmount is automatic.

## Plugin (optional)

Install the plugin once when you want a single instance shared across the tree:

```ts
// main.ts
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

// Must be called from setup().
const resurrect = injectSorobanResurrect()

async function withdraw(tx: Transaction, wallet: WalletAdapter) {
  return resurrect.submitWithRestore({ transaction: tx, wallet })
}
</script>
```

`injectSorobanResurrect()` throws when the plugin was not installed. To detect that instead of failing — for example to hide a plugin-only code path — inject the exported key with a default: `inject(SOROBAN_RESURRECT_KEY, null)`.

The plugin instance is constructed once at boot from a static config, so apply later config changes with the SDK's in-place network switch:

```ts
resurrect.switchNetwork({ rpcUrl, networkPassphrase })
```

This re-binds the RPC client without dropping registered listeners, history, or the state machine. The instance is also the plain `SorobanResurrect` facade, so `onStateChange`, `detectArchivedKeys`, `reset` and the rest are available directly.

## Notes

- `state.message` is a human-readable string safe to render in the UI, and `state.archivedKeys` is populated once the workflow reaches `restore_needed` and later states.
- Never call `useSorobanResurrect` or `injectSorobanResurrect` outside `setup()` — both rely on the component instance for lifecycle and injection.
- Not using Vue? `@soroban-resurrect/sdk` has no framework dependency — see [Getting Started](/guide/getting-started) for the plain SDK API.
