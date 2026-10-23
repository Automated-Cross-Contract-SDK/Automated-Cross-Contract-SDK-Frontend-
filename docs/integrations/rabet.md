# Rabet

Adapter for the [Rabet](https://rabet.io) browser extension (`window.rabet`).

## Install

```bash
npm install @soroban-resurrect/adapter-rabet
```

## Usage

```ts
import { RabetAdapter } from '@soroban-resurrect/adapter-rabet'

const wallet = new RabetAdapter()
const result = await sr.submitWithRestore({ transaction, wallet })

// or, via the factory:
const wallet2 = await createAdapter('rabet')
```

## Constructor options

| Option  | Type       | Default        | Description                                          |
| ------- | ---------- | -------------- | ---------------------------------------------------- |
| `rabet` | `RabetApi` | `window.rabet` | Override the Rabet API object (tests, custom injection). |

No environment variables are required.

## Scaffolder

When generating a new project with the scaffolder, select Rabet as the wallet
integration:

```bash
npx @soroban-resurrect/scaffolder my-app --wallet rabet
```

Supported wallet values are `freighter` and `rabet`. Omitting `--wallet` (or
passing an unsupported value) fails with a clear error listing the supported
integrations. The generated project includes a `README` section and a
`.env.example` entry matching the chosen wallet:

```bash
# .env.example (rabet)
VITE_WALLET_INTEGRATION=rabet
```

## SSR / browser constraints

The adapter reads `window.rabet`, so construct it only in the browser (e.g. inside
`useEffect`, `onMounted`, or a client-only component). On the server — or when the
extension is not installed — the constructor throws unless a `rabet` instance is passed.

Capabilities: `signAuthEntry: false`, `feeBump: true`, `hardware: false`.
