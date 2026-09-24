import { createApp } from 'vue'
import { SorobanResurrectPlugin } from '@soroban-resurrect/vue-hook'
import App from './App.vue'
import { DEFAULT_NETWORK_PASSPHRASE, DEFAULT_RPC_URL, USE_PLUGIN } from './config.js'
import './styles.css'

const app = createApp(App)

// --- optional plugin path ---------------------------------------------------
// `app.use(SorobanResurrectPlugin, { config })` builds exactly one
// SorobanResurrect instance at boot and hands it to every component that calls
// `injectSorobanResurrect()` — one RPC client, one workflow state, no prop
// drilling.
//
// It is opt-in here (`VITE_USE_PLUGIN=true`) so the example doubles as a
// comparison: leave it off and each consumer still gets its own instance from
// `useSorobanResurrect(config)`.
if (USE_PLUGIN) {
  app.use(SorobanResurrectPlugin, {
    config: {
      rpcUrl: DEFAULT_RPC_URL,
      networkPassphrase: DEFAULT_NETWORK_PASSPHRASE,
    },
  })
}

app.mount('#app')
