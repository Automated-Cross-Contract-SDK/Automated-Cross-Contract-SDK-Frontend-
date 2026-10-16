## Summary

This PR addresses four wallet and SDK API issues:

- Publish a compatibility matrix for all supported wallet adapters, including signing behavior, required setup/options, limitations, and the locked provider API versions.
- Validate SDK URLs, timing values, fee settings, and incompatible archive-detection options at construction time with field-specific errors.
- Add `getEffectiveConfig()` to return validated settings with defaults applied, without constructing runtime RPC/cache resources.
- Add validated per-request restore workflow overrides while keeping the instance configuration frozen and unchanged.

## Behavior notes

- `submitWithRestore` supports request overrides for polling intervals/timeouts, restore fee multiplier/cap, sequence retries, and restore memos.
- Overrides are validated before a request is recorded. Batched requests with per-request overrides run sequentially so each transaction uses its own settings.
- `SorobanResurrect.config` and the settings returned by `getEffectiveConfig()` are frozen snapshots.

## Validation

- Focused configuration-resolution tests pass.
- The SDK-wide test and typecheck suites are currently blocked by pre-existing SDK source issues on `main` (including invalid syntax in `Executor.ts` and missing exports from `types.ts`).
