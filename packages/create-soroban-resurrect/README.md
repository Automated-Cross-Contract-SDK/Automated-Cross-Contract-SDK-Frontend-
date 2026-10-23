# create-soroban-resurrect

Scaffold a minimal Vite + React app wired to `@soroban-resurrect/sdk`: one
wallet adapter (via `createAdapter`), a restore-aware call button, and a TTL
warning banner.

```bash
npm create soroban-resurrect@latest my-app
# non-interactive
npm create soroban-resurrect@latest my-app -- --network testnet --wallet freighter --framework react --language ts
```

Prompts: **network** (`testnet`, `futurenet`, `mainnet`), **wallet**
(`freighter`, `albedo`, `xbull`, `lobstr`, `rabet`), **framework** (`react`,
`vanilla`) and **language** (`ts`, `js`). Choices land in the generated `.env`
and template files; set `VITE_CONTRACT_ID` there before `npm run dev`.

## Template choices

| Framework | Language | Template dir        | Scripts                         |
| --------- | -------- | ------------------- | ------------------------------- |
| `react`   | `ts`     | `template/react-ts` | `dev`, `build`, `preview`       |
| `react`   | `js`     | `template/react-js` | `dev`, `build`, `preview`       |
| `vanilla` | `ts`     | `template/vanilla-ts` | `dev`, `build`, `preview`     |
| `vanilla` | `js`     | `template/vanilla-js` | `dev`, `build`, `preview`     |

Every template pins `@soroban-resurrect/sdk` to the CLI's own version and ships
runnable `dev`/`build`/`preview` scripts, so `npm install && npm run dev` works
out of the box. Invalid `--framework`/`--language` values fail fast with a
non-zero exit and a list of supported options.

## Compatibility & migration

- `--framework` and `--language` are optional; omitting them keeps the previous
  default (`react` + `ts`), so existing invocations are unaffected.
- The legacy single `template/` directory is now `template/react-ts`; projects
  scaffolded before this change need no migration — only new scaffolds use the
  per-choice directories.

The templates live under `template/` in this repo and are type-checked against
the SDK's current types in CI (`npm run typecheck -w packages/create-soroban-resurrect`),
so they cannot drift from the published API.
