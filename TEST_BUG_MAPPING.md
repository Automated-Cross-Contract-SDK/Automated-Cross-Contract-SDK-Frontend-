# Test-to-Bug Regression Mapping

This document maps each fixed bug to its corresponding regression test(s), ensuring
that every fix is validated by at least one automated test. When a test fails, this
mapping helps trace the failure back to the original bug it was designed to prevent.

---

## Bug Fix Categories & Test Mappings

### Bug #20: Direct Ledger Query Detection
**Fix Summary:** Added `archiveDetectionMethod` config option with `'simulation'` and
`'direct'` strategies. Exposed new `detectArchivedKeysViaDirect()` function.

| Test File | Test Name | What It Validates |
|---|---|---|
| `Archiver.test.ts` | `detectArchivedKeysViaDirect › throws on simulation error response` | Direct detection propagates simulation errors |
| `Archiver.test.ts` | `detectArchivedKeysViaDirect › throws on restore response` | Direct detection errors when simulation already shows restore needed |
| `Archiver.test.ts` | `detectArchivedKeysViaDirect › returns empty when no readWrite entries` | Direct detection handles empty footprints |
| `Archiver.test.ts` | `detectArchivedKeysViaDirect › detects archived entries from success response footprint` | Direct detection correctly identifies archived entries from ledger queries |
| `Archiver.test.ts` | `detectArchivedKeysViaSimulation › returns archived keys from restore response` | Simulation-based detection extracts keys correctly |
| `Archiver.test.ts` | `detectArchivedKeysViaSimulation › returns empty array for success response` | Simulation-based detection handles success responses |
| `Archiver.test.ts` | `detectArchivedKeysViaSimulation › returns empty array for error response` | Simulation-based detection handles error responses |
| `SorobanResurrect.test.ts` | `config option: archiveDetectionMethod › defaults to simulation` | Config defaults to simulation detection |
| `SorobanResurrect.test.ts` | `config option: archiveDetectionMethod › accepts direct detection method` | Direct method is accepted as config value |

---

### Bug #21: buildRestoreTx State Side-Effects
**Fix Summary:** `buildRestoreTx()` now accepts an optional pre-computed `simulationResponse`,
avoiding internal `simulate()` calls that would trigger unwanted state transitions.

| Test File | Test Name | What It Validates |
|---|---|---|
| `SorobanResurrect.test.ts` | `buildRestoreTx › accepts optional simulationResponse to avoid state side-effects` | When simulationResponse is provided, internal state does not change to 'simulating' |

---

### Bug #24 / #34: Hardcoded / Unconfigurable RESTORE_FEE_MULTIPLIER
**Fix Summary:** Added `restoreFeeMultiplier` config option (default: 3). The multiplier
was originally hardcoded to 100, which could significantly overcharge users.

| Test File | Test Name | What It Validates |
|---|---|---|
| `SorobanResurrect.test.ts` | `config option: restoreFeeMultiplier › defaults to 3` | Default multiplier is the reasonable value of 3 |
| `SorobanResurrect.test.ts` | `config option: restoreFeeMultiplier › accepts custom restoreFeeMultiplier` | Custom multiplier (50) is applied |
| `restoreFeeMultiplier.test.ts` | `base fee multiplication with the default multiplier › multiplies minResourceFee by the default RESTORE_FEE_MULTIPLIER (100)` | Default multiplier arithmetic is correct (note: test was written when default was 100) |
| `restoreFeeMultiplier.test.ts` | `base fee multiplication with the default multiplier › scales correctly for an arbitrary base fee` | Multiplier scales correctly |
| `restoreFeeMultiplier.test.ts` | `custom restoreFeeMultiplier › uses a custom multiplier from config instead of the default` | Custom multiplier (50) overrides default |
| `restoreFeeMultiplier.test.ts` | `custom restoreFeeMultiplier › applies a multiplier of 1 (no amplification)` | Multiplier of 1 (no amplification) works |
| `restoreFeeMultiplier.test.ts` | `custom restoreFeeMultiplier › applies a multiplier greater than the default` | Multiplier > default works |
| `restoreFeeMultiplier.test.ts` | `edge cases with very large and very small fees` (5 tests) | Edge cases: 0 fee, 1 fee, large fees, precision |

---

### Bug #26 / #37: Inconsistent / Missing Error Callbacks
**Fix Summary:** All error paths in `executeWithRestore()` now consistently invoke
`onRestoreFailed`. Previously, several error paths (simulation errors, unexpected
response types, catch-all exceptions) silently returned without calling the callback.

| Test File | Test Name | What It Validates |
|---|---|---|
| `Executor.test.ts` | `calls onRestoreFailed on simulation error response` | Callback fires on simulation error |
| `Executor.test.ts` | `calls onRestoreFailed when wallet is not connected` | Callback fires on wallet disconnect |
| `Executor.test.ts` | `calls onRestoreFailed when catch-all exception occurs` | Callback fires on unexpected errors |
| `Executor.test.ts` | `handles unexpected simulation response type` | Callback fires on unknown sim response type |
| `submitWithRestore.callbackOrder.test.ts` | `stops after onRestoreFailed and never reaches later callbacks when the restore transaction fails on-chain` | Callback invoked; subsequent callbacks NOT invoked |
| `submitWithRestore.callbackOrder.test.ts` | `calls only onRestoreFailed, before any signing callbacks, when the wallet is not connected` | Callback is the only one that fires |
| `submitWithRestore.callbackOrder.test.ts` | `calls only onRestoreFailed when the initial simulation errors` | Callback is the only one that fires |
| `submitWithRestore.callbackOrder.test.ts` | `calls onRestoreFailed and stops if the signed original transaction cannot be parsed after a successful restore` | Callback fires; onOriginalSubmitted does NOT fire |

---

### Bug #27: Envelope Extraction Missing Fallback
**Fix Summary:** `extractXdrOperations()` was refactored to handle all envelope types
(V0, V1, FeeBump) explicitly, with descriptive error messages for unknown types.
Previously, unknown envelope types would silently fall through to V1 handling.

| Test File | Test Name | What It Validates |
|---|---|---|
| `Restorer.test.ts` | `[regression #27] extracts operations from a fee-bump transaction envelope` | Fee-bump envelopes are handled correctly |
| `Restorer.test.ts` | `[regression #27] extracts operations from a V0 transaction envelope` | V0 envelopes are handled correctly |
| `Restorer.test.ts` | `[regression #27] throws descriptive error on unknown envelope type` | Unknown types throw with the envelope type name in the message |
| `Restorer.test.ts` | `[regression #27] throws descriptive error on unsupported inner envelope type in fee-bump` | Unsupported inner types in fee-bump throw with descriptive message |

---

### Bug #28 / #35: Root Test Script Missing React-Hook Coverage
**Fix Summary:** Root `package.json` test script was updated to run both SDK and
react-hook tests (`npm run test -w packages/sdk && npm run test -w packages/react-hook`).

| Test File | Test Name | What It Validates |
|---|---|---|
| N/A (CI configuration) | Not a code-level fix — validated by CI passing both packages | React-hook tests are now included in CI pipeline |

---

### Bug #32: onRestoreFailed Callback Inconsistency (State Management)
**Fix Summary:** The `onRestoreFailed` callback wrapper was updated to include state
management (`setState('error', ...)`) before invoking the user's callback, ensuring
consistent state transitions across all callback types.

| Test File | Test Name | What It Validates |
|---|---|---|
| `submitWithRestore.callbackOrder.test.ts` | `[regression #32] sets error state BEFORE invoking onRestoreFailed callback` | State is 'error' when the user's `onRestoreFailed` callback fires, and remains 'error' after the call completes |

---

### Bug #33: Network Passphrase Validation
**Fix Summary:** Constructor now throws on invalid network passphrases instead of
logging a warning. The `KNOWN_NETWORK_PASSPHRASES` list was fixed to include the
correct Futurenet passphrase.

| Test File | Test Name | What It Validates |
|---|---|---|
| `SorobanResurrect.test.ts` | `config option: networkPassphrase validation › accepts known network passphrases` | Testnet, Mainnet, Futurenet all accepted |
| `SorobanResurrect.test.ts` | `config option: networkPassphrase validation › throws on invalid network passphrase` | Invalid passphrase throws with descriptive message |
| `SorobanResurrect.test.ts` | `config option: networkPassphrase validation › throws on typo in network passphrase` | Typos in passphrase throw (e.g., 2016 instead of 2015) |
| `SorobanResurrect.test.ts` | `config option: networkPassphrase validation › uses Testnet by default when no passphrase provided` | Testnet is the default |

---

### Bug #36: import.meta.env Reads in Examples Without Fallback
**Fix Summary:** The `examples/basic/src/App.tsx` file already had a `getEnvVariable()`
helper wrapping `import.meta.env` reads with try-catch and fallback defaults.

| Test File | Test Name | What It Validates |
|---|---|---|
| N/A (example code) | Validated in the example app itself via the `getEnvVariable()` helper | Environment reads have fallback defaults |

---

## Test Count Summary

| Bug # | New Regression Tests Added | Total Tests Covering This Bug |
|---|---|---|
| #20 | 9 | 9 |
| #21 | 1 | 1 |
| #24 / #34 | 11 | 11 |
| #26 / #37 | 8 | 8 |
| #27 | 4 | 6 |
| #28 / #35 | N/A (CI) | N/A |
| #32 | 1 | 1 |
| #33 | 4 | 4 |
| #36 | N/A (example) | N/A |

---

## How to Use This Mapping

1. **When a test fails:** Look up the test name in this document to find the original
   bug number and fix description. This tells you what behavior the test is guarding.

2. **When fixing a new bug:** After writing the fix, add a regression test that
   reproduces the original broken behavior (expecting the fixed behavior). Tag the
   test name with `[regression #NN]` and add an entry to this document.

3. **Test naming convention:** Regression tests should include the bug number in
   their name, e.g., `[regression #27] throws descriptive error on unknown envelope type`.

---

*Last updated: July 30, 2026*
