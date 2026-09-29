# create-soroban-resurrect

Scaffold a minimal Vite + React app wired to `@soroban-resurrect/sdk`: one
wallet adapter (via `createAdapter`), a restore-aware call button, and a TTL
warning banner.

```bash
npm create soroban-resurrect@latest my-app
# non-interactive
npm create soroban-resurrect@latest my-app -- --network testnet --wallet freighter
```

Prompts: **network** (`testnet`, `futurenet`, `mainnet`) and **wallet**
(`freighter`, `albedo`, `xbull`, `lobstr`, `rabet`). Choices land in the
generated `.env`; set `VITE_CONTRACT_ID` there before `npm run dev`.

The template lives in `template/` in this repo and is type-checked against the
SDK's current types in CI (`npm run typecheck -w packages/create-soroban-resurrect`),
so it cannot drift from the published API.
