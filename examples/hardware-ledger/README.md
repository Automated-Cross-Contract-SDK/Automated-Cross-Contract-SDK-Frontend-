# Hardware wallet (Ledger) restore demo

Connects a Ledger with `createLedgerAdapter`, detects archived ledger entries
for a contract call, and runs `submitWithRestore` — the device confirms each
signature (the restore transaction, then the resubmitted original).

## Run without hardware (mock transport)

```bash
npm install && npm run build:sdk      # from the repo root
npm run dev:mock -w examples/hardware-ledger
```

`vite --mode mock` aliases `@ledgerhq/hw-app-str` to
`src/mock/MockStellarApp.ts`, so the real `LedgerWalletAdapter` code runs
against a software key with a simulated confirmation delay. RPC is served by
the shared `@soroban-resurrect/testing` harness (archived footprint → restore →
confirm → resubmit), so no network or funded account is required.

## Run with a Ledger device

```bash
npm run dev -w examples/hardware-ledger
```

Prerequisites:

- A Chromium-based browser (WebUSB) on `localhost` or HTTPS.
- Ledger firmware up to date, and the **Stellar** app installed via Ledger Live.
- The device unlocked with the Stellar app **open** before clicking _Connect_.
- In the Stellar app settings, enable **Hash signing** — Soroban transactions are
  signed by hash (blind signing), which the app disables by default.
- A funded **testnet** account at the chosen derivation path. Set
  `VITE_CONTRACT_ID` in `.env.local` to a contract whose state you want to restore.

### BIP44 account index

Stellar uses `m/44'/148'/<index>'` (SLIP-0044 coin type 148). The account index
input picks `<index>`: `0` is the first account shown in Ledger Live, `1` the
second, and so on. Change it before connecting.

### Hardware UX notes

- Signing waits on the user, so transactions are built with a 120 s timeout.
- A full restore needs **two** approvals: the restore transaction and the
  original call.
- The Ledger app does not support per-entry auth signing
  (`capabilities.signAuthEntry === false`).
