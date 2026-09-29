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

## SSR / browser constraints

The adapter reads `window.rabet`, so construct it only in the browser (e.g. inside
`useEffect`, `onMounted`, or a client-only component). On the server — or when the
extension is not installed — the constructor throws unless a `rabet` instance is passed.

Capabilities: `signAuthEntry: false`, `feeBump: true`, `hardware: false`.
