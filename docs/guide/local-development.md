# Local Development with Docker Compose

Testing against Testnet is slow and its ledger entries are shared with everyone
else. For day-to-day development, run a private Soroban network locally with the
`docker-compose.yml` at the repo root. A local network gives you instant ledger
closes, a funded root account, and full control over TTL and archival, which is
exactly what you need when testing restoration flows.

## Dev container / Codespaces

The repo ships a `.devcontainer/devcontainer.json`, so a fresh Codespace or VS Code
dev container starts ready to build:

- Node 20 (satisfies `engines.node >= 18`) and npm `10.9.8` (the `packageManager` pin).
- `npm ci` runs on post-create, so `npm run verify` works straight away.
- Port `5173` (docs site, `npm run docs:dev`) and `8000` (local Soroban RPC) are forwarded.
- Docker-in-Docker is enabled, so `docker compose up -d` below works inside the
  container and the RPC is reachable at `http://localhost:8000/soroban/rpc`. If your
  environment disallows nested Docker, run the compose network on the host instead.

## Repository health report

Before opening a pull request, run the read-only health report. It never writes
to the working tree — it only inspects the repo and prints actionable results:

```bash
npm run health
```

Each check reports `PASS`, `WARN`, or `FAIL` with a hint on how to fix it:

| Check | What it verifies |
|-------|------------------|
| `formatting` | Prettier config is present and `format:check` is wired up. |
| `scripts` | Required npm scripts (`build`, `test`, `lint`, `format:check`, `verify`) exist. |
| `tests` | Each workspace package ships at least one test file. |
| `exports` | Package `exports`/`main`/`types` entries point at files that exist. |
| `docs` | Relative links in `docs/` resolve to real files. |

The command exits non-zero when any check `FAIL`s, so it can gate CI. Pass
`--json` for machine-readable output and `--strict` to treat warnings as failures.

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Docker Engine | 24.x |
| Docker Compose | v2 (`docker compose`, not `docker-compose`) |
| Free ports | `8000`, `11626` |

## Starting the network

```bash
docker compose up -d
```

The first run pulls the `stellar/quickstart` image, which is large, so expect a
few minutes. Follow the boot process with:

```bash
docker compose logs -f soroban-rpc
```

The node is ready once the healthcheck reports healthy:

```bash
docker compose ps
```

You can also poll the RPC endpoint directly:

```bash
curl -s -X POST http://localhost:8000/soroban/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

A healthy node responds with `{"jsonrpc":"2.0","id":1,"result":{"status":"healthy"}}`.

## Endpoints

| Service | URL |
|---------|-----|
| Soroban RPC | `http://localhost:8000/soroban/rpc` |
| Horizon | `http://localhost:8000` |
| Friendbot | `http://localhost:8000/friendbot?addr=<G...>` |
| Stellar Core HTTP | `http://localhost:11626` |

The local network uses the standard Testnet passphrase,
`Test SDF Network ; September 2015`, which is what
`DEFAULT_NETWORK_PASSPHRASE` already resolves to.

## Pointing the SDK at the local node

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { Networks } from '@stellar/stellar-sdk'

const sr = new SorobanResurrect({
  rpcUrl: 'http://localhost:8000/soroban/rpc',
  networkPassphrase: Networks.TESTNET,
})
```

For the example app, set the RPC URL in `examples/basic/.env.local`:

```bash
VITE_RPC_URL=http://localhost:8000/soroban/rpc
VITE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

## Funding a test account

Friendbot runs inside the container, so any keypair can be funded without
leaving your machine:

```bash
curl "http://localhost:8000/friendbot?addr=GABC...XYZ"
```

## Resetting the ledger

Restoration tests depend on entries actually reaching an archived state, so it
is common to want a clean ledger. Tear the network down along with its volume:

```bash
docker compose down -v
docker compose up -d
```

Omitting `-v` keeps the ledger between restarts.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `port is already allocated` | Something else owns `8000` or `11626`. Stop it, or change the host side of the port mapping in `docker-compose.yml`. |
| Healthcheck never passes | The node needs up to a minute on first boot. Check `docker compose logs soroban-rpc` for a Core error before restarting. |
| `Transaction simulation failed` on every call | Usually a passphrase mismatch. The local network is Testnet-passphrased, not Standalone-passphrased. |
| Requests hang from a browser app | The RPC server allows cross-origin requests, but a mixed-content page served over HTTPS cannot call `http://localhost`. Serve the dev app over HTTP. |

## Stopping the network

```bash
docker compose down
```

## Handling a broken release

If a published release turns out to be broken, follow the
[release rollback and incident-response runbook](./release-runbook.md). It covers
confirming the problem, assessing impact, communicating with consumers, choosing
between rollback and forward-fix, and directing consumers to a safe version.
