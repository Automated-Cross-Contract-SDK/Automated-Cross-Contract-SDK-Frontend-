## Summary

- Standardized wallet adapter errors with typed `WalletError` codes and actionable user-rejection messages.
- Added optional wallet network detection and fail-fast network mismatch validation before signing.
- Added Freighter CAP-0046 `signAuthEntry` support and capability declaration.
- Added Playwright wallet extension E2E coverage with nightly/manual CI execution, artifacts, and contributor documentation.

## Validation

- Synced and rebased onto the latest `main`.
- Resolved all merge conflicts.
- `git diff --check` passed.
- Prettier checks passed.
- GitHub Actions workflow YAML parsed successfully.
- Full typecheck and test suite could not run locally because dependencies are unavailable; the lockfile currently references unavailable `@lobstrco/signer-extension-api@^1.0.2`.

Closes #265
Closes #264
Closes #263
Closes #262
