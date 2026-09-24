# Bug Fixes Summary

This document summarizes the fixes for issues #20, #21, #24, and #26 in the Soroban-Resurrect SDK.

## Bug #20: Direct Ledger Query Detection

### Problem

The SDK only supported simulation-based detection of archived keys. A lower-level direct ledger query function existed but wasn't exposed or integrated into the main API.

### Solution

Added a new configuration option `archiveDetectionMethod` to allow users to choose between two detection strategies:

1. **Simulation-based** (default): Uses `simulateTransaction` and extracts archived keys from the restore response
2. **Direct ledger query**: Simulates successfully, extracts footprint keys, then queries the ledger directly

### Changes

- **types.ts**: Added `archiveDetectionMethod?: 'simulation' | 'direct'` to `SorobanResurrectConfig`
- **Archiver.ts**:
  - Added `detectArchivedKeysViaSimulation()` function
  - Added `detectArchivedKeysViaDirect()` function
  - Added `extractFootprintFromSuccess()` helper (previously unexported)
- **SorobanResurrect.ts**: Updated `detectArchivedKeys()` to use config-based detection method
- **index.ts**: Exported new public functions

### Usage

```typescript
// Simulation-based (default)
const resurrect = new SorobanResurrect({
  rpcUrl: 'https://...',
})

// Direct ledger query
const resurrect = new SorobanResurrect({
  rpcUrl: 'https://...',
  archiveDetectionMethod: 'direct',
})
```

## Bug #21: buildRestoreTx State Side-Effects

### Problem

`buildRestoreTx()` always called `simulate()` internally, which set internal state to 'simulating'. This caused unwanted state changes when called during the `submitWithRestore` workflow, potentially interfering with status tracking.

### Solution

Refactored `buildRestoreTx()` to accept an optional pre-computed simulation response parameter, avoiding internal state changes when called with this parameter.

### Changes

- **SorobanResurrect.ts**: Updated `buildRestoreTx()` signature:
  ```typescript
  async buildRestoreTx(
    sourcePublicKey: string,
    transaction: Transaction,
    simulationResponse?: rpc.Api.SimulateTransactionRestoreResponse
  )
  ```
- When `simulationResponse` is provided, it's used directly without triggering state changes
- When omitted, the transaction is simulated first (existing behavior)
- Updated JSDoc to clearly document state side-effect behavior

### Usage

```typescript
// Without simulation response (simulates internally, updates state)
const restoreTx = await resurrect.buildRestoreTx(publicKey, transaction)

// With simulation response (no state side-effects)
const simResponse = await resurrect.server.simulateTransaction(transaction)
if (isRestoreResponse(simResponse)) {
  const restoreTx = await resurrect.buildRestoreTx(publicKey, transaction, simResponse)
}
```

## Bug #24: Hardcoded RESTORE_FEE_MULTIPLIER

> **Superseded default:** this entry is the historical record of the change that made the
> multiplier configurable, written when the initial default was still `100`. A later change
> (see `BUG_FIXES_COMPLETED.md`) lowered the default to **3**, which is what the SDK ships today
> (`RESTORE_FEE_MULTIPLIER` in `constants.ts`). The code samples below are left as originally
> written for historical accuracy — do not treat "100" as the current default. See
> [`docs/api/types.md`](docs/api/types.md#restore-fee-model) for the current fee model.

### Problem

The restore transaction fee multiplier was hardcoded to `100` (100x the minimum resource fee), which could significantly overcharge users, especially on Mainnet. This value wasn't configurable.

### Solution

Added a new optional configuration option `restoreFeeMultiplier` with a default value of 100 at the time (see note above; since lowered to 3), allowing users to adjust the fee strategy based on their needs.

### Changes

- **types.ts**: Added `restoreFeeMultiplier?: number` to `SorobanResurrectConfig`
- **SorobanResurrect.ts**: Constructor now resolves `restoreFeeMultiplier` with default
- **Restorer.ts**: `buildRestoreTransaction()` uses config value instead of hardcoded constant

### Usage

```typescript
// Default (100x multiplier)
const resurrect = new SorobanResurrect({
  rpcUrl: 'https://...',
})

// Custom multiplier (more reasonable for Mainnet)
const resurrect = new SorobanResurrect({
  rpcUrl: 'https://...',
  restoreFeeMultiplier: 5, // 5x multiplier
})
```

## Bug #26: Inconsistent Error Callbacks

### Problem

Several error paths in `executeWithRestore()` didn't invoke the `onRestoreFailed` callback, leading to inconsistent callback behavior and potentially confusing users about what went wrong.

### Solution

Audited all error paths and ensured consistent callback invocation:

### Changes

- **Executor.ts**: Updated error handling in `executeWithRestore()`:
  1. **Simulation error response**: Now calls `onRestoreFailed` with error message
  2. **Simulation succeeds but wallet not connected**: Already calls `onRestoreFailed` ✓
  3. **Signed restore tx parse failure**: Already calls `onRestoreFailed` ✓
  4. **Restore tx submission/confirmation failure**: Already calls `onRestoreFailed` ✓
  5. **Signed original tx parse failure**: Now returns error without callback (before confirm)
  6. **Unexpected simulation response type**: Now calls `onRestoreFailed`
  7. **Catch-all exception**: Now calls `onRestoreFailed`

- Updated JSDoc to clarify callback semantics

### Error Paths Fixed

```typescript
// Before: No callback for simulation error
if (isErrorResponse(simResponse)) {
  return { success: false, error: `Simulation error: ...` }
}

// After: Callback invoked
if (isErrorResponse(simResponse)) {
  const err = `Simulation error: ...`
  onRestoreFailed?.(err)
  return { success: false, error: err }
}
```

## Testing

### Test Coverage

All 58 tests passing:

- **Executor.test.ts**: 10 tests (including 3 new callback tests)
- **Archiver.test.ts**: 23 tests (including 7 new direct detection tests)
- **SorobanResurrect.test.ts**: 18 tests (including 3 new config tests)
- **Restorer.test.ts**: 7 tests

### New Tests Added

1. **Config Options** (SorobanResurrect.test.ts):
   - `restoreFeeMultiplier` defaults to 100
   - `restoreFeeMultiplier` accepts custom values
   - `archiveDetectionMethod` defaults to 'simulation'
   - `archiveDetectionMethod` accepts 'direct' value

2. **buildRestoreTx** (SorobanResurrect.test.ts):
   - Accepts optional `simulationResponse` without state side-effects

3. **Error Callbacks** (Executor.test.ts):
   - `onRestoreFailed` called on simulation error response
   - `onRestoreFailed` called when wallet not connected
   - `onRestoreFailed` called on unexpected response type
   - `onRestoreFailed` called on catch-all exception

4. **Direct Detection** (Archiver.test.ts):
   - `detectArchivedKeysViaSimulation()` returns keys from restore response
   - `detectArchivedKeysViaSimulation()` returns empty for success/error
   - `detectArchivedKeysViaDirect()` throws on errors appropriately
   - `detectArchivedKeysViaDirect()` detects archived entries from footprint

### Build Status

✅ All packages build successfully (SDK, React Hook, Example)
✅ TypeScript compilation clean
✅ All tests passing

## Migration Guide

### For Existing Code

No breaking changes. All updates are backward compatible:

```typescript
// Existing code continues to work without changes
const resurrect = new SorobanResurrect({ rpcUrl: '...' })
const result = await resurrect.submitWithRestore({ transaction, wallet })
```

### To Use New Features

**Use direct ledger detection:**

```typescript
const resurrect = new SorobanResurrect({
  rpcUrl: '...',
  archiveDetectionMethod: 'direct',
})
```

**Customize restore fee multiplier:**

```typescript
const resurrect = new SorobanResurrect({
  rpcUrl: '...',
  restoreFeeMultiplier: 3, // 3x instead of 100x
})
```

**Avoid state side-effects with buildRestoreTx:**

```typescript
const simResponse = await resurrect.server.simulateTransaction(tx)
if (isRestoreResponse(simResponse)) {
  const restoreTx = await resurrect.buildRestoreTx(publicKey, tx, simResponse)
}
```

**Listen to error callbacks:**

```typescript
const result = await resurrect.submitWithRestore({
  transaction,
  wallet,
  onRestoreFailed: (error) => {
    console.error('Restore failed:', error)
  },
})
```

## Files Modified

1. `/packages/sdk/src/types.ts` - Added config options
2. `/packages/sdk/src/SorobanResurrect.ts` - Updated detection and buildRestoreTx
3. `/packages/sdk/src/Archiver.ts` - Added new detection functions
4. `/packages/sdk/src/Restorer.ts` - Use config multiplier
5. `/packages/sdk/src/Executor.ts` - Fixed error callback paths
6. `/packages/sdk/src/index.ts` - Exported new functions
7. `/packages/sdk/src/__tests__/SorobanResurrect.test.ts` - Added config tests
8. `/packages/sdk/src/__tests__/Executor.test.ts` - Added callback tests
9. `/packages/sdk/src/__tests__/Archiver.test.ts` - Added detection tests
