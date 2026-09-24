# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `ARCHITECTURE.md`, and expanded JSDoc /
  API reference documentation.

## [0.1.0] - 2026-07-28

Initial development release of Soroban-Resurrect — an automated cross-contract
state restoration SDK and wallet middleware for Soroban dApps affected by
CAP-0066 archived ledger entries.

### Added

- **`@soroban-resurrect/sdk`** core package:
  - `SorobanResurrect` facade class with an observer-pattern state machine
    (`idle` → `simulating` → `restore_needed` → `signing_restore` →
    `submitting_restore` → `confirming_restore` → `signing_original` →
    `submitting_original` → `success`/`error`).
  - `Archiver` module — simulation-response type guards
    (`isRestoreResponse`, `isSuccessResponse`, `isErrorResponse`) and
    archived-key extraction (`extractArchivedKeys`,
    `extractFootprintFromSuccess`, `detectArchivedEntries`).
  - `Restorer` module — restore transaction builder
    (`buildRestoreTransaction`), transaction confirmation polling
    (`waitForTransaction`) with exponential backoff and jitter, and
    post-restore transaction rebuilding (`buildOriginalAfterRestore`,
    `prepareTransaction`).
  - `Executor` module — full orchestration of the simulate → restore →
    sign → submit workflow (`executeWithRestore`).
  - Two archive-detection strategies: `simulation` (default, derives
    archived keys from the restore simulation response) and `direct`
    (queries the ledger directly for footprint keys).
  - Configurable network passphrase, poll interval/timeout, and restore
    fee multiplier, with sane Testnet defaults.
  - Barrel exports of all public types and functions from the package
    entry point.
  - Unit and integration test suite (vitest) covering type guards, key
    extraction, transaction building, polling, and the full restore
    orchestration flow.
- **`@soroban-resurrect/react-hook`** package:
  - `SorobanResurrectProvider` context provider and
    `useSorobanResurrectContext` hook for app-wide SDK access.
  - Standalone `useSorobanResurrect` hook for use without a context
    provider, with automatic SDK re-instantiation on config change.
  - `isProcessing` derived state for driving loading/disabled UI states.
- **`examples/basic`** — Vite + React demo app showing a Freighter
  wallet connect and withdraw flow using the SDK.
- Monorepo tooling: npm workspaces, shared `tsconfig.base.json`, ESLint
  flat config with `typescript-eslint` and Prettier integration,
  Prettier formatting config, and a GitHub Actions CI workflow (build,
  lint, format, test, typecheck).
- MIT `LICENSE` and initial `README.md` with architecture diagram,
  quick-start guide, and API reference.

### Fixed

- Corrected the archive detection method selection so the configured
  `archiveDetectionMethod` (`simulation` vs `direct`) is respected
  end-to-end.
- Fixed `buildRestoreTx` to avoid unnecessary duplicate simulation calls
  and related state side effects.
- Fixed the restore fee multiplier not being applied consistently when
  building restore transactions.
- Fixed callback ordering and missing invocations
  (`onRestoreNeeded`, `onSigningRestore`, `onRestoreFailed`) across the
  restore-and-submit workflow.
- Resolved a `ReferenceError` on `onRestoreFailed` and various
  TypeScript/JSX configuration issues and lint warnings.
- Fixed exponential backoff timing, an account sequence-number race
  condition when building concurrent transactions, and SDK config
  tracking issues.
- Added missing state machine transitions and improved overall restore
  flow robustness and error propagation.
- Fixed an authentication/slippage issue causing exact-amount
  transactions to fail auth during v2→v3 migration flows.

[unreleased]: https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/compare/main...HEAD
[0.1.0]: https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/releases/tag/v0.1.0
