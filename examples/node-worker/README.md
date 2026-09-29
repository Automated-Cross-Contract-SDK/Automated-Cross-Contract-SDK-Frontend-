# Node.js restore worker

A server-side maintenance job that keeps a contract's storage alive. On a
schedule it calls `getExpiringEntriesForContract` to find archived and
soon-to-expire entries, then restores them with `restoreKeys` — no source
transaction, no browser, no wallet extension. It uses a plain `WalletAdapter`
backed by a local `Keypair`.

**Network:** testnet by default (configurable).

## Prerequisites

- Node.js 20.6+ (for `--env-file-if-exists`; use 22+ to be safe)
- A funded account whose secret key the worker will hold (testnet: use Friendbot)
- The repo packages built: `npm install && npm run build:sdk` from the repo root

## Run

```bash
cp .env.example .env   # fill in CONTRACT_ID and WORKER_SECRET_KEY
npm run dev            # scan + restore every SCAN_INTERVAL_SECONDS
npm start              # scan + restore once, then exit (for system cron / CI)
```

Example crontab entry for the one-shot mode:

```cron
0 * * * * cd /srv/node-worker && npm start >> worker.log 2>&1
```

Progress is logged through the `restoreKeys` lifecycle callbacks
(`onSigningRestore`, `onSubmittingRestore`, `onRestoreSubmitted`,
`onRestoreConfirmed`).

## Key management — a deliberate trade-off

An unattended job cannot ask a human to approve a signature, so the worker
holds a **hot key**: a secret that lives on the server and signs without
confirmation. That is the price of automation. Contain it:

- **Dedicated account.** Use a key that exists only to pay restore fees — never
  a treasury, admin or contract-owner key. Restoring requires no special
  authority, so this account needs no privileges.
- **Low balance.** Fund it with just enough XLM for a few restores and top it up
  on a schedule. A leak then costs at most that balance.
- **Secret storage.** Inject `WORKER_SECRET_KEY` from a secrets manager (Vault,
  AWS/GCP Secret Manager, Kubernetes secrets). Never commit `.env`.
- **Fee cap.** Set `maxRestoreFeeStroops` in the `SorobanResurrect` config to
  bound what a single restore may spend.
- **Rotation.** Rotate the key periodically and whenever the host is suspect.

If a hot key is unacceptable, keep the scan here and hand signing to a remote
signer or HSM by replacing `keypairWallet()` with an adapter that calls it.

## Configuration

See [`.env.example`](./.env.example). `getExpiringEntriesForContract` scans the
contract instance and Wasm code by default; to include persistent storage
entries, pass their `storageKeys` in `src/worker.mjs`.
