# WalletConnect example

Pairs a mobile Stellar wallet over [WalletConnect v2](https://docs.reown.com)
using `@soroban-resurrect/adapter-walletconnect`, then detects archived state
and submits a transaction with automatic restore. Every signature is approved
on the phone.

**Network:** testnet by default (configurable).

## Prerequisites

- Node.js 18+
- A WalletConnect (Reown) **project id** — create one free at
  <https://cloud.reown.com> and add `http://localhost:5175` to its allowed
  domains
- A mobile Stellar wallet that supports WalletConnect v2 and `stellar_signXDR`
  (e.g. LOBSTR, Freighter Mobile) with a funded testnet account
- The repo packages built: `npm install && npm run build` from the repo root

## Run

```bash
cp .env.example .env   # set VITE_WC_PROJECT_ID
npm run dev            # http://localhost:5175
```

Click **Pair wallet**, scan the QR code, approve the session, then
**Detect & submit withdraw**.

## Configuration

| Variable                  | Required | Purpose                                                        |
| ------------------------- | -------- | -------------------------------------------------------------- |
| `VITE_WC_PROJECT_ID`      | yes      | WalletConnect project id; the relay rejects connections without it |
| `VITE_WC_RELAY_URL`       | no       | Custom relay; defaults to `wss://relay.walletconnect.com`      |
| `VITE_RPC_URL`            | no       | Soroban RPC endpoint                                           |
| `VITE_NETWORK_PASSPHRASE` | no       | Selects the CAIP-2 chain (`stellar:testnet` / `stellar:pubnet`) |
| `VITE_CONTRACT_ID`        | no       | Contract invoked by the demo transaction                       |

## Session lifecycle

- **Connect** — `client.connect()` returns a pairing URI (shown as a QR code)
  and an `approval()` promise that resolves with the session. The session must
  grant a `stellar` account on the configured chain and the `stellar_signXDR`
  method, otherwise `WalletConnectAdapter` throws.
- **Resume** — SignClient persists sessions; an unexpired one is reused on reload.
- **Disconnect** — `client.disconnect()` from the dApp, or the `session_delete`
  event when the wallet ends it.
- **Expiry** — the `session_expire` event clears the adapter; the user pairs again.

The adapter does not own the pairing lifecycle — it just wraps a connected
client and approved session, so you can plug in a shared connector (e.g.
Reown AppKit) instead of the hand-rolled flow here.
