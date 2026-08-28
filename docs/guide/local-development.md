# Local Development with Docker Compose

Running against a local Soroban RPC node gives you a fast, disposable network for
testing restore flows: you control the ledger, entries archive in seconds instead
of weeks, and you never spend Testnet friendbot funds.

This repo ships a `docker-compose.yml` at its root that boots a
[`stellar/quickstart`](https://github.com/stellar/quickstart) container with
Stellar Core, Horizon, and Soroban RPC in local (standalone) mode.

## Requirements

- Docker 24+ and the Docker Compose plugin (`docker compose version`)
- ~2 GB of free RAM for the container
- Ports `8000` and `11626` free on the host

## Start the node

```bash
docker compose up -d
```

The first boot takes about a minute while Core initialises the local ledger.
Follow the logs until the node is producing ledgers:

```bash
docker compose logs -f soroban-rpc
```

Compose runs a health check against the RPC `getHealth` method, so you can wait
for readiness instead of guessing:

```bash
docker compose ps
# STATUS shows "healthy" once the RPC endpoint is accepting requests
```

## Endpoints

| Service | URL |
|---------|-----|
| Soroban RPC | `http://localhost:8000/rpc` |
| Horizon | `http://localhost:8000` |
| Friendbot | `http://localhost:8000/friendbot?addr=<G...>` |
| Core HTTP | `http://localhost:11626` |

The container is started with `NETWORK_PASSPHRASE` set to the Testnet
passphrase. The SDK validates passphrases against a known list and maps the
`localhost` host to the Testnet passphrase, so a local node using the standalone
passphrase would be rejected at construction time.

## Point the SDK at it

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { Networks } from '@stellar/stellar-sdk'

const sr = new SorobanResurrect({
  rpcUrl: 'http://localhost:8000/rpc',
  networkPassphrase: Networks.TESTNET,
})
```

For the example app, set the RPC URL through the environment rather than editing
source:

```bash
VITE_SOROBAN_RPC_URL=http://localhost:8000/rpc npm run dev:example
```

## Fund a test account

Local quickstart runs its own friendbot, so no Testnet rate limits apply:

```bash
curl "http://localhost:8000/friendbot?addr=GABC...XYZ"
```

## Verify RPC is answering

```bash
curl -s -X POST http://localhost:8000/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

A healthy node responds with `"status":"healthy"` plus the current ledger range.

## Reset the ledger

Archived-entry testing usually means you want a clean chain. Tearing the volume
down gives you a fresh genesis ledger:

```bash
docker compose down -v
docker compose up -d
```

Use `docker compose down` without `-v` to stop the node but keep its state.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `bind: address already in use` | Another process holds `8000`. Stop it, or change the host side of the port mapping in `docker-compose.yml`. |
| Container stays `unhealthy` | Core is still catching up. Check `docker compose logs soroban-rpc`; allow up to two minutes on a cold volume. |
| `Invalid network passphrase` from the SDK | The container was started without `NETWORK_PASSPHRASE`. Recreate it with `docker compose up -d --force-recreate`. |
| Simulation returns "entry not found" for a deployed contract | The ledger was reset. Redeploy the contract and re-seed its storage. |
