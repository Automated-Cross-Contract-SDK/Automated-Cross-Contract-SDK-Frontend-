# React Native Example

Mobile integration of `@soroban-resurrect/react-hook` in a bare React Native app.

Demonstrates:

- Registering `SorobanResurrectProvider` at the root of a React Native app
- The Node polyfills (`react-native-get-random-values`, `buffer`) that
  `@stellar/stellar-sdk` needs to run in the React Native JS engine —
  imported first thing in `index.js`, before any SDK code
- A local, `Keypair`-based `WalletAdapter` for demo purposes (real apps
  should integrate a proper mobile wallet instead of handling secret keys
  directly — see the warning in `App.tsx`)

## Setup

This example expects a standard bare React Native project setup (Xcode /
Android Studio toolchains installed). From this directory:

```bash
npm install
npx pod-install ios   # iOS only
npm run android        # or: npm run ios
```

Metro's default resolver already understands npm workspaces, so it resolves
`@soroban-resurrect/sdk` and `@soroban-resurrect/react-hook` straight from
the monorepo's `packages/*` sources.
