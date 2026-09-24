# Examples

Sample applications showing how to integrate `@soroban-resurrect/sdk` and
`@soroban-resurrect/react-hook` in different environments. Each example is
self-contained — see its own `README.md` for setup instructions.

| Example | Demonstrates |
| --- | --- |
| [`basic`](./basic) | Minimal Vite + React integration using `SorobanResurrectProvider` and `useSorobanResurrectContext`. |
| [`vanilla-js`](./vanilla-js) | Plain JavaScript usage of `@soroban-resurrect/sdk` directly — no framework. |
| [`nextjs-app`](./nextjs-app) | Next.js App Router integration, with the provider isolated behind a single `'use client'` boundary. |
| [`react-native`](./react-native) | React Native mobile integration, including the Node polyfills the SDK needs on-device. |
| [`multi-contract`](./multi-contract) | Interacting with multiple independent contracts through one shared `SorobanResurrectProvider`. |

All examples are npm workspaces, so `@soroban-resurrect/sdk` and
`@soroban-resurrect/react-hook` resolve to this repo's `packages/*` sources.
Build the packages first from the repo root:

```bash
npm install
npm run build:sdk
npm run build:hook
```

Then `cd` into any example directory and follow its README.
