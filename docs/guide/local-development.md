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

## Verifying endpoint readiness

Rather than eyeballing `curl` output, use the bundled readiness helper. It polls
the RPC endpoint until it reports healthy, then exits `0`; on timeout or a
malformed response it exits non-zero with a diagnostic. Run it before examples
or in CI to fail fast when the local node is not up yet.

```bash
# Defaults to http://localhost:8000/soroban/rpc
npm run rpc:check

# Or point it at any endpoint
npm run rpc:check -- --url http://localhost:8000/soroban/rpc --timeout 60000
```

Stable interface:

| Flag | Default | Description |
|------|---------|-------------|
| `--url <url>` | `http://localhost:8000/soroban/rpc` | Soroban RPC endpoint to probe. |
| `--timeout <ms>` | `30000` | Total time to keep retrying before failing. |
| `--interval <ms>` | `1000` | Delay between retries. |

Exit codes: `0` healthy, `1` timed out / unreachable, `2` malformed response.

## Inspecting package release readiness

Before cutting a release, run the release-readiness inspector. It summarizes
workspace version alignment, build results, package contents, and required
release metadata, then exits non-zero if anything is not ready. It is
inspection-only: it never publishes or mutates artifacts.

```bash
# Inspect the whole workspace
npm run release:check

# Or scope it to a single package
npm run release:check -- --package @soroban-resurrect/sdk
```

Stable interface:

| Flag | Default | Description |
|------|---------|-------------|
| `--package <name>` | all workspace packages | Limit the report to a single package by name. |
| `--json` | off | Emit the report as machine-readable JSON instead of a table. |

Exit codes: `0` ready, `1` one or more checks failed, `2` invalid arguments.

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

## Smoke-testing a generated app

After scaffolding an app with the `scaffolder` package, verify that it installs,
builds, and exposes the public SDK imports before wiring up a wallet. The
`smoke-test` command runs these checks without requiring any wallet credentials:

```bash
npx @soroban-resurrect/scaffolder smoke-test ./my-app
```

It performs three checks and exits non-zero if any fail:

1. **Dependencies** — the app's `package.json` resolves and required SDK
   dependencies are declared.
2. **Build** — the app compiles via its configured build script.
3. **Public SDK imports** — the generated entry point imports the public SDK
   surface (`@soroban-resurrect/sdk`) without needing a funded account or wallet.

Run it in CI right after generation to catch broken templates early. No secrets,
keys, or network access to a live RPC are required.

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
| `rpc:check` exits `1` | The node is not up yet or the URL is wrong. Confirm with `docker compose ps` and the `curl` probe above. |
| `rpc:check` exits `2` | The endpoint answered but not with a valid `getHealth` result. Check the URL points at `/soroban/rpc`, not Horizon. |
| `release:check` exits `1` | One or more readiness checks failed. Re-run with `--json` to see which package and check failed. |

## Stopping the network

```bash
docker compose down
```

## Handling a broken release

If a published release turns out to be broken, follow the
[release rollback and incident-response runbook](./release-runbook.md). It covers
confirming the problem, assessing impact, communicating with consumers, choosing
between rollback and forward-fix, and directing consumers to a safe version.
