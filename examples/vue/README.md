# Vue Example

Vue 3 integration of `@soroban-resurrect/vue-hook` in a Vite + TypeScript app.

Demonstrates:

- **Composable usage** (`src/components/ComposableWithdraw.vue`):
  `useSorobanResurrect(config)` owns an SDK instance scoped to the component.
  It accepts a config **getter**, so the instance follows the network picker —
  a new instance (and a reset `state`) whenever the config changes — and it
  subscribes to the state machine for you: `state`, `isProcessing`, `isSuccess`
  and friends are reactive refs, so the template never touches `onStateChange`.
- **Optional plugin usage** (`src/components/PluginWithdraw.vue`):
  `app.use(SorobanResurrectPlugin, { config })` builds one shared instance and
  hands it to any component that calls `injectSorobanResurrect()`. The example
  installs the plugin only when `VITE_USE_PLUGIN=true`; otherwise the picker
  hides the plugin mode instead of failing inside `injectSorobanResurrect()`.
- **Wallet connect + withdraw flow**, mirroring `examples/basic`: connect the
  Freighter extension, check a transaction's archived entries with
  `detectArchivedKeys()`, then submit it with `submitWithRestore()` using a
  hand-rolled `WalletAdapter` for Freighter's injected `window.stellar` API.
- **State-machine-driven UI**: the progress steps and error hints come from the
  SDK's workflow states, not from timers or local flags.

Both paths render the same presentational `WithdrawCard.vue`, which is the point:
the only difference is how the SDK instance and its reactive state are obtained.

|                | Composable                    | Plugin                       |
| -------------- | ----------------------------- | ---------------------------- |
| Instance       | one per component             | one per app (`app.use`)      |
| Consumed with  | `useSorobanResurrect(config)` | `injectSorobanResurrect()`   |
| Reactive state | provided by the composable    | bridged from `onStateChange` |
| Config changes | re-creates the instance       | `resurrect.switchNetwork()`  |

## Setup

Build the workspace packages first (they are consumed from `packages/*`, not
from the registry):

```bash
cd ../..
npm install
npm run build:sdk
npm run build:hook
```

Then, from this directory:

```bash
npm run dev            # composable path
VITE_USE_PLUGIN=true npm run dev   # adds the plugin path to the picker
```

Open the printed URL, install the
[Freighter](https://www.freighter.app/) browser extension, and click "Connect
Freighter Wallet" → "Submit Withdraw" to run the flow against Testnet. There is
no real contract at the default `CONTRACT_ID` — point it at your own deployment
(set `VITE_CONTRACT_ID`, or edit `src/config.ts`) with a `withdraw(i128)`
function to see an archived entry actually restored.

## Configuration

| Env var                   | Purpose                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `VITE_RPC_URL`            | RPC endpoint. Setting it (or `VITE_NETWORK_PASSPHRASE`) boots the app into the **Custom** network preset. |
| `VITE_NETWORK_PASSPHRASE` | Network passphrase. Must be a known Stellar passphrase — the SDK rejects unknown ones.                    |
| `VITE_CONTRACT_ID`        | Contract the sample `withdraw(1000)` call targets.                                                        |
| `VITE_USE_PLUGIN`         | `true` installs `SorobanResurrectPlugin` via `app.use()`, enabling the plugin mode in the picker.         |

`npm run build` and `npm run typecheck` run `vue-tsc` over the app and its
single-file components.
