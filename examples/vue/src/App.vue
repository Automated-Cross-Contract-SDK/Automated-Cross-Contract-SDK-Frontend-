<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { SOROBAN_RESURRECT_KEY } from '@soroban-resurrect/vue-hook'
import NetworkSelector from './components/NetworkSelector.vue'
import WalletButton from './components/WalletButton.vue'
import ComposableWithdraw from './components/ComposableWithdraw.vue'
import PluginWithdraw from './components/PluginWithdraw.vue'
import {
  INITIAL_NETWORK,
  isValidRpcUrl,
  resolveNetworkConfig,
  type NetworkConfig,
  type NetworkId,
} from './config.js'

/**
 * `main.ts` installs `SorobanResurrectPlugin` only when `VITE_USE_PLUGIN=true`.
 * Probing the injection key — instead of calling `injectSorobanResurrect()`,
 * which throws — lets the picker hide the plugin mode when it is unavailable.
 */
const pluginInstalled = inject(SOROBAN_RESURRECT_KEY, null) !== null

const networkId = ref<NetworkId>(INITIAL_NETWORK.id)
const customNetwork = ref<NetworkConfig>({ ...INITIAL_NETWORK.custom })
const address = ref<string | null>(null)
const mode = ref<'composable' | 'plugin'>('composable')

// Keep the SDK pointed at the last *valid* custom config: a URL is momentarily
// invalid while it is being typed, and `SorobanResurrect` rejects that
// (`config.rpcUrl must be a valid URL`), so invalid values never reach it.
const usableCustomNetwork = ref<NetworkConfig>({ ...INITIAL_NETWORK.custom })
watch(
  customNetwork,
  (value) => {
    if (isValidRpcUrl(value.rpcUrl)) usableCustomNetwork.value = { ...value }
  },
  { deep: true, immediate: true },
)

const activeNetwork = computed(() =>
  resolveNetworkConfig(networkId.value, usableCustomNetwork.value),
)
</script>

<template>
  <main class="sr-app">
    <h1>Soroban-Resurrect – Vue Example</h1>
    <p class="sr-tagline">
      Submit a contract call that transparently restores any archived state it touches.
    </p>

    <section class="sr-card">
      <NetworkSelector v-model:id="networkId" v-model:custom="customNetwork" />
      <WalletButton :address="address" @connected="address = $event" />
    </section>

    <section class="sr-card">
      <p class="sr-label">Vue integration</p>
      <div class="sr-modes">
        <label class="sr-mode">
          <input v-model="mode" type="radio" value="composable" />
          <span>
            <strong>Composable</strong>
            <small>
              <code>useSorobanResurrect(config)</code> — an SDK instance owned by the component,
              re-created when the network changes.
            </small>
          </span>
        </label>
        <label class="sr-mode" :class="{ 'sr-mode--disabled': !pluginInstalled }">
          <input v-model="mode" type="radio" value="plugin" :disabled="!pluginInstalled" />
          <span>
            <strong>Plugin (<code>app.use</code>)</strong>
            <small>
              <code>injectSorobanResurrect()</code> — one shared SDK instance for the whole app,
              switched in place with <code>switchNetwork()</code>.
            </small>
          </span>
        </label>
      </div>
      <p v-if="!pluginInstalled" class="sr-note">
        The plugin is opt-in: start the dev server with <code>VITE_USE_PLUGIN=true</code> to install
        <code>SorobanResurrectPlugin</code> in <code>main.ts</code>.
      </p>
    </section>

    <ComposableWithdraw v-if="mode === 'composable'" :config="activeNetwork" :address="address" />
    <PluginWithdraw v-else :network="activeNetwork" :address="address" />
  </main>
</template>
