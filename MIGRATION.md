# Migration Guide

This document tracks breaking changes between releases of `@soroban-resurrect/sdk` and `@soroban-resurrect/react-hook`, and explains how to migrate your integration across them.

## Versioning Policy

Both packages follow [Semantic Versioning](https://semver.org/):

- **0.x releases** (current) — Pre-1.0. The public API may still change between minor versions as the SDK stabilizes. Breaking changes will always be called out in this guide.
- **1.0 and beyond** — Once 1.0 ships, breaking changes will only occur in major version bumps (`1.x` → `2.0`), following normal semver guarantees.

If you're building on top of a `0.x` release, pin an exact version or a tilde range (`~0.1.0`) rather than a caret range (`^0.1.0`) to avoid picking up an unannounced breaking change while the API is still settling.

---

## Upgrading to v1.0 (from 0.x)

`v1.0.0` marks the SDK's public API as stable. If you're upgrading from any `0.x` version, review the checklist below before bumping your dependency.

### What "stable" means going forward

- The shape of `SorobanResurrectConfig`, `WalletAdapter`, `ResurrectResult`, `SubmitWithRestoreOptions`, `RestoreState`, and `RestoreStateInfo` (exported from `@soroban-resurrect/sdk`) is frozen for the `1.x` line. New optional fields may be added in minor releases, but existing fields will not be renamed or removed without a major bump.
- The `SorobanResurrect` class's public methods (`simulate`, `detectArchivedKeys`, `needsRestore`, `buildRestoreTx`, `submitWithRestore`, `onStateChange`, `reset`) keep their current signatures for the `1.x` line.
- The React hook exports (`SorobanResurrectProvider`, `useSorobanResurrectContext`, `useSorobanResurrect`) keep their current signatures for the `1.x` line.
- Anything not re-exported from a package's `index.ts` (for example internal helpers in `Restorer.ts`, `Executor.ts`, and `Archiver.ts`) is not part of the public API and may change at any time, in any release, without notice.

### Checklist when upgrading

1. **Pin exact versions during the transition.** Upgrade `@soroban-resurrect/sdk` and `@soroban-resurrect/react-hook` together — the react-hook package depends on a matching SDK version range.
2. **Re-run `npm install` at the workspace root** so the lockfile picks up the new versions for both packages consistently.
3. **Check your `SorobanResurrectConfig` usage.** If you were relying on undocumented/internal fields (i.e. fields not listed in the [README's Types section](./README.md#types)), they are not covered by the stability guarantee and may have changed.
4. **Check custom `WalletAdapter` implementations.** The interface (`isConnected`, `getPublicKey`, `signTransaction`) is unchanged going into 1.0, but confirm your adapter still satisfies the type after upgrading `@stellar/stellar-sdk`, since that's a peer dependency and its own major bumps can affect `Transaction`/`xdr` types used in signatures.
5. **Re-run your type-check** (`npm run typecheck` or your project's equivalent) after upgrading — this is the fastest way to catch any incompatibility in your integration.
6. **Review callback usage in `submitWithRestore`.** The full set of lifecycle callbacks (`onSigningRestore`, `onSubmittingRestore`, `onSigningOriginal`, `onRestoreNeeded`, `onRestoreSubmitted`, `onRestoreConfirmed`, `onOriginalSubmitted`, `onRestoreFailed`) is stable as of 1.0 and will not be renamed in the `1.x` line.

### No action needed if...

You only use the documented public API surface (see the [API Reference](./README.md#api-reference) in the README) and don't reach into internal modules directly — in that case, upgrading to 1.0 should be a drop-in version bump.

---

## Future Breaking Changes

When a future major version introduces breaking changes, a new dated section will be added above this one, following this format:

```md
## Upgrading to vX.0 (from vY.x)

### Breaking Changes
- <change> — <why, and what to do instead>

### Migration Steps
1. ...
```

If you hit an issue migrating between versions that isn't covered here, please open an issue in this repository.
