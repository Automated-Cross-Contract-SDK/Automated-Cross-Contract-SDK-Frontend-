# Testing Package Changes Locally

Before publishing a change to `@soroban-resurrect/sdk` or any of the hook and
adapter packages, you usually want to run it inside a real consumer app. There
are three ways to do that, in increasing order of fidelity to a real install:

| Approach | Best for | Trade-off |
|----------|----------|-----------|
| Workspace linking | Changes tested by an app inside this repo | Only works for `examples/*` in this monorepo |
| `npm link` | Quick iteration in an external app | Symlinks, so peer deps can resolve twice |
| `yalc` | Verifying the published artifact | Requires a re-push on every change |

## 0. Build first, always

Every package publishes compiled output, not `src`. Whatever approach you pick,
the consumer resolves the built files, so a stale `dist` means you are testing
stale code.

```bash
npm run build:sdk          # only @soroban-resurrect/sdk
npm run build              # all packages plus the example app
```

Leave a watcher running while iterating:

```bash
npm run build -w packages/sdk -- --watch
```

## 1. Workspace linking (inside this repo)

`examples/basic` already depends on the workspace packages, so `npm install` at
the repo root symlinks them for you. No extra tooling is needed:

```bash
npm install
npm run build:sdk
npm run dev:example
```

Use this whenever the change can be exercised by an app in `examples/`.

## 2. `npm link` (external app)

`npm link` creates a global symlink to your local package, then a second symlink
from the consumer's `node_modules` to it.

```bash
# 1. Register the local package globally
cd packages/sdk
npm link

# 2. Consume it from your app
cd ~/projects/my-dapp
npm link @soroban-resurrect/sdk
```

Rebuild in the SDK and the app picks the change up immediately, since it is
reading through a symlink.

Linking several packages at once:

```bash
cd packages/sdk && npm link
cd ../react-hook && npm link
cd ~/projects/my-dapp
npm link @soroban-resurrect/sdk @soroban-resurrect/react-hook
```

Unlink when finished, then reinstall so the app goes back to the registry copy:

```bash
cd ~/projects/my-dapp
npm unlink --no-save @soroban-resurrect/sdk
npm install

cd packages/sdk
npm unlink -g @soroban-resurrect/sdk
```

### The duplicate peer dependency trap

`@stellar/stellar-sdk` and `react` are peer dependencies. Because a symlinked
package resolves its own `node_modules` first, your app can end up loading two
copies of them, which shows up as `Invalid hook call` in React or as XDR
instances failing `instanceof` checks in Stellar code.

Point both sides at one copy:

```bash
# From the consumer app, link its copies back into the SDK
cd packages/sdk
npm link ~/projects/my-dapp/node_modules/react
npm link ~/projects/my-dapp/node_modules/@stellar/stellar-sdk
```

With Vite, the equivalent fix is to dedupe in `vite.config.ts`:

```typescript
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom', '@stellar/stellar-sdk'],
  },
  optimizeDeps: {
    // Linked packages are not pre-bundled by default
    exclude: ['@soroban-resurrect/sdk', '@soroban-resurrect/react-hook'],
  },
})
```

## 3. `yalc` (closest to a real install)

`yalc` copies the package into a local store and installs it as a file
dependency instead of a symlink. It respects `files`/`.npmignore`, so it catches
the class of bug where something works locally but is missing from the published
tarball.

```bash
npm install -g yalc
```

### Publish and consume

```bash
# 1. Build, then publish to the local yalc store
cd packages/sdk
npm run build
yalc publish

# 2. Add it to the consumer app
cd ~/projects/my-dapp
yalc add @soroban-resurrect/sdk
npm install
```

### Push updates

`yalc push` republishes and updates every consumer that added the package:

```bash
cd packages/sdk
npm run build && yalc push
```

Since `yalc` copies rather than symlinks, nothing propagates until you push.
Chain the build with the push, or wrap it in a script:

```bash
# packages/sdk/package.json
"scripts": {
  "dev:yalc": "npm run build && yalc push"
}
```

### Remove

```bash
cd ~/projects/my-dapp
yalc remove @soroban-resurrect/sdk
npm install
```

`yalc remove --all` clears every yalc-linked package from the app at once.

### Keep yalc out of commits

`yalc add` writes a `.yalc/` directory and a `yalc.lock`, and rewrites the
dependency in `package.json` to a `file:.yalc/...` specifier. Add these to the
consumer app's `.gitignore`:

```
.yalc/
yalc.lock
```

Always run `yalc remove --all` and `npm install` before committing the consumer
app, so a `file:` specifier never reaches a lockfile in version control.

## Verifying the tarball itself

To check exactly what a consumer will download, without a registry:

```bash
cd packages/sdk
npm pack                                   # writes soroban-resurrect-sdk-0.1.0.tgz
tar -tf soroban-resurrect-sdk-0.1.0.tgz    # inspect the file list

cd ~/projects/my-dapp
npm install /path/to/soroban-resurrect-sdk-0.1.0.tgz
```

This is the highest-fidelity check available before an actual publish.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Changes do not appear in the app | `dist` is stale (`npm run build:sdk`), or with yalc you forgot `yalc push`. |
| `Invalid hook call` | Two copies of React. Dedupe as shown above. |
| Types resolve to `any` | The consumer's TypeScript is reading `dist` before it exists. Build first, then restart the TS server. |
| Vite serves old code | Clear the dep cache: `rm -rf node_modules/.vite` and restart. |
| `Cannot find module '@soroban-resurrect/sdk'` after unlinking | The symlink is gone but the registry copy was never installed. Run `npm install`. |
