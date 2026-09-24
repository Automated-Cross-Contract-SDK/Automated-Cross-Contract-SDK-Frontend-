# Vanilla JS Example

Plain JavaScript usage of `@soroban-resurrect/sdk` — no framework, no React.

Demonstrates:

- Constructing a `SorobanResurrect` instance directly
- Subscribing to workflow state changes with `onStateChange`
- Calling `submitWithRestore` with a hand-rolled `WalletAdapter` for the
  Freighter browser extension
- Rendering UI updates with plain DOM APIs

## Running

```bash
npm install
npm run dev
```

Open the printed local URL, install the [Freighter](https://www.freighter.app/)
browser extension, and click "Connect Freighter Wallet" followed by "Submit
Withdraw" to try the flow against Testnet (edit `CONTRACT_ID` in `src/main.js`
to point at your own deployed contract).
