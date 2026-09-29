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
- **Persisted transaction history** (`persistHistoryExample.tsx`): passing
  `persistHistory: { storage: AsyncStorage }` so the SDK hydrates
  `TransactionHistory` from durable storage on startup and `retry(historyId)`
  keeps working after an app kill. `await sdk.ready` before reading persisted
  history. Requires `@react-native-async-storage/async-storage`.

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

## TTL watch-and-extend (`ttlWatchExample.tsx`)

`ttlWatchExample.tsx` shows the proactive flow on mobile: it polls
`getExpiringSoonEntries()` for a set of ledger keys, shows a warning banner
once any entry drops below the threshold (~24 h), and extends the entries via
`restoreKeys()` only when the user taps **Extend now**.

Polling is tied to `AppState`: it stops when the app goes to the background
(where iOS/Android suspend JS timers anyway) and restarts — with an immediate
poll — when the app returns to the foreground. The component uses only React
Native APIs; it never touches `window` or `document`.

Render it with your wallet adapter and the keys to watch:

```tsx
<TTLWatchExample wallet={wallet} keys={[positionKey]} />
```

### Required polyfills

`@stellar/stellar-sdk` needs Node globals that React Native lacks. Load these
in `index.js` **before** any SDK import (already done in this example):

- `react-native-get-random-values` — `crypto.getRandomValues` for key generation
- `buffer` — assign `global.Buffer = Buffer`
- `react-native-url-polyfill/auto` — spec-compliant `URL` for the RPC client (if your RN version's `URL` is incomplete)
