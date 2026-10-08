# Astro example

Reference implementation for [`docs/integrations/astro.md`](../../docs/integrations/astro.md).
Archive detection and restore run inside a React island
(`src/components/RestoreIsland.tsx`) mounted with `client:only="react"`, so
none of it executes during SSR / `astro build`.

- No browser global (`window`, `freighterApi`) is read at module scope — the
  wallet adapter is created inside the click handler.
- `index.astro` frontmatter runs on the server and imports nothing that
  touches the network or a wallet.

## Run

```bash
npm install
npm run build:sdk && npm run build:hook   # from the repo root
npm run dev -w examples/astro
npm run build -w examples/astro           # runs `astro build`
```
