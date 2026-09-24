# Local Package Development (npm link / yalc)

When you change `@soroban-resurrect/sdk` or one of the framework hook packages,
you usually want a real consumer app to pick the change up before anything is
published to npm. There are two ways to do that: `npm link`, which is built in,
and [yalc](https://github.com/wclr/yalc), which is closer to what an actual
install looks like.

## Which one to use

| | `npm link` | `yalc` |
|---|---|---|
| Setup | Built into npm | `npm i -g yalc` |
| Mechanism | Symlink into the consumer's `node_modules` | Copies the packed tarball contents |
| Catches missing `files` entries | No | Yes |
| Duplicate React / peer-dep instances | Common | Rare |
| Good for | Quick one-off checks | Anything longer than a few minutes |

Reach for `yalc` by default. Use `npm link` when you want a change to appear in
the consumer without re-publishing on every edit.

## Before you start

Both approaches consume `dist/`, not `src/`, because that is what the package
`exports` field points at. Build first:

```bash
npm run build:sdk
```

Or keep a rebuild running while you work:

```bash
npm run build -w packages/sdk -- --watch
```

## Using yalc

### 1. Publish the package to the local store

From the package directory:

```bash
cd packages/sdk
yalc publish
```

`yalc publish` respects the `files` field in `package.json`, so if a file is
missing from the published output here, it would be missing from npm too.

### 2. Add it to the consumer

From the consumer app:

```bash
cd ~/my-dapp
yalc add @soroban-resurrect/sdk
npm install
```

This writes a `file:.yalc/@soroban-resurrect/sdk` dependency and a `yalc.lock`.
Do not commit either.

### 3. Push updates after each change

```bash
cd packages/sdk
npm run build
yalc push
```

`yalc push` republishes and updates every consumer that added the package, so
this is the command you repeat while iterating.

### 4. Clean up

```bash
cd ~/my-dapp
yalc remove @soroban-resurrect/sdk
npm install
```

Use `yalc remove --all` to detach every yalc-linked package at once.

## Using npm link

### 1. Register the package globally

```bash
cd packages/sdk
npm link
```

### 2. Link it into the consumer

```bash
cd ~/my-dapp
npm link @soroban-resurrect/sdk
```

The consumer's `node_modules/@soroban-resurrect/sdk` is now a symlink to your
working copy, so a rebuild is visible immediately with no further commands.

### 3. Unlink

```bash
cd ~/my-dapp
npm unlink --no-save @soroban-resurrect/sdk
npm install

cd packages/sdk
npm unlink -g
```

## Linking the hook packages

The hook packages depend on the SDK, so link the SDK first and then the hook,
otherwise the hook resolves a published SDK instead of your local one:

```bash
cd packages/sdk && yalc publish
cd ../react-hook && yalc add @soroban-resurrect/sdk && npm run build && yalc publish

cd ~/my-dapp
yalc add @soroban-resurrect/sdk @soroban-resurrect/react-hook
npm install
```

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Changes do not show up | `dist/` is stale. Run `npm run build:sdk`, and with yalc also `yalc push`. |
| `Cannot find module '@soroban-resurrect/sdk'` | Run `npm install` in the consumer after `yalc add`, or re-run `npm link`. |
| `Invalid hook call` / two React copies | `npm link` gave the hook package its own `react`. Point the consumer's bundler at a single React, or switch to yalc. |
| Two `@stellar/stellar-sdk` instances | Same cause as above. `stellar-sdk` is a peer dependency and must resolve to one copy. |
| Vite does not reload the linked package | Linked packages sit outside the project root. Add `optimizeDeps: { exclude: ['@soroban-resurrect/sdk'] }` to the consumer's Vite config. |
| A file is missing only under yalc | It is not covered by `files` in the package's `package.json`. It would be missing from the npm release too, so fix it there. |

## Do not commit link artifacts

`.yalc/`, `yalc.lock`, and any `file:` or `link:` dependency belong to your
machine only. Confirm they are absent with `git status` before opening a pull
request.
