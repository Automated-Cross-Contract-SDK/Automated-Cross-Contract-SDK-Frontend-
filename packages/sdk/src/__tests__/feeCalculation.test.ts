/**
 * Direct unit tests for feeCalculation.ts (#300).
 *
 * Covers:
 * 1. Multiplier resolution — the default (3), explicit overrides, and the
 *    `??` fallback semantics.
 * 2. Bounds — `feeCalculation.ts` itself neither clamps nor throws for a
 *    multiplier below 1; that bound is enforced once, at config validation
 *    time (`resolveConfig` / the `SorobanResurrect` constructor), so these
 *    helpers apply whatever multiplier they are given.
 * 3. Precision — `minResourceFee` arrives from RPC as a decimal string and is
 *    parsed to an integer before the multiplication, so results are checked
 *    against exact `BigInt` arithmetic across the safe-integer range.
 * 4. `buildRestoreCostEstimate`, which composes the two helpers.
 */

import { describe, it, expect } from 'vitest'
import {
  buildRestoreCostEstimate,
  calculateRestoreFee,
  resolveRestoreFeeMultiplier,
} from '../feeCalculation.js'
import { RESTORE_FEE_MULTIPLIER } from '../constants.js'
import type { SorobanResurrectConfig } from '../types.js'

const baseConfig: SorobanResurrectConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
}

describe('resolveRestoreFeeMultiplier', () => {
  it('returns the default RESTORE_FEE_MULTIPLIER when config has no restoreFeeMultiplier', () => {
    expect(resolveRestoreFeeMultiplier(baseConfig)).toBe(RESTORE_FEE_MULTIPLIER)
  })

  it('returns the custom multiplier when config.restoreFeeMultiplier is set', () => {
    expect(resolveRestoreFeeMultiplier({ ...baseConfig, restoreFeeMultiplier: 5 })).toBe(5)
  })

  it('returns 1 when config.restoreFeeMultiplier is explicitly 1', () => {
    expect(resolveRestoreFeeMultiplier({ ...baseConfig, restoreFeeMultiplier: 1 })).toBe(1)
  })

  it('returns a large custom multiplier unchanged', () => {
    expect(resolveRestoreFeeMultiplier({ ...baseConfig, restoreFeeMultiplier: 1000 })).toBe(1000)
  })
})

describe('calculateRestoreFee', () => {
  it('returns minResourceFee * default multiplier as a string', () => {
    const result = calculateRestoreFee(100, baseConfig)
    expect(result).toBe((100 * RESTORE_FEE_MULTIPLIER).toString())
  })

  it('returns a string (not a number)', () => {
    expect(typeof calculateRestoreFee(100, baseConfig)).toBe('string')
  })

  it('uses a custom multiplier from config', () => {
    const result = calculateRestoreFee(100, { ...baseConfig, restoreFeeMultiplier: 5 })
    expect(result).toBe('500')
  })

  it('handles minResourceFee of 0', () => {
    expect(calculateRestoreFee(0, baseConfig)).toBe('0')
  })

  it('handles minResourceFee of 1 with default multiplier', () => {
    expect(calculateRestoreFee(1, baseConfig)).toBe(RESTORE_FEE_MULTIPLIER.toString())
  })

  it('handles a multiplier of 1 (no amplification)', () => {
    expect(calculateRestoreFee(999, { ...baseConfig, restoreFeeMultiplier: 1 })).toBe('999')
  })

  it('handles large fee values without losing precision', () => {
    const largeFee = 1_000_000
    const result = calculateRestoreFee(largeFee, { ...baseConfig, restoreFeeMultiplier: 10 })
    expect(result).toBe('10000000')
    expect(Number(result)).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })
})

describe('resolveRestoreFeeMultiplier — defaults and fallback semantics', () => {
  it('defaults to 3', () => {
    expect(RESTORE_FEE_MULTIPLIER).toBe(3)
    expect(resolveRestoreFeeMultiplier(baseConfig)).toBe(3)
  })

  it('falls back to the default when restoreFeeMultiplier is explicitly undefined', () => {
    expect(resolveRestoreFeeMultiplier({ ...baseConfig, restoreFeeMultiplier: undefined })).toBe(3)
  })

  it('returns a fractional multiplier unchanged', () => {
    expect(resolveRestoreFeeMultiplier({ ...baseConfig, restoreFeeMultiplier: 1.5 })).toBe(1.5)
  })

  it('does not read other config fields', () => {
    const config: SorobanResurrectConfig = {
      ...baseConfig,
      maxRestoreFeeStroops: '1',
      pollIntervalMs: 1,
    }
    expect(resolveRestoreFeeMultiplier(config)).toBe(3)
  })
})

describe('resolveRestoreFeeMultiplier / calculateRestoreFee — multiplier < 1', () => {
  // The >= 1 bound is validated when the SDK config is resolved; these pure
  // helpers neither clamp nor throw, and `??` only falls back for
  // null/undefined — so a falsy 0 is honoured rather than replaced by 3.
  it.each([0.5, 0.1, 0])('passes a multiplier of %s through without clamping', (multiplier) => {
    const config = { ...baseConfig, restoreFeeMultiplier: multiplier }
    expect(resolveRestoreFeeMultiplier(config)).toBe(multiplier)
    expect(() => calculateRestoreFee(100, config)).not.toThrow()
  })

  it('applies a sub-1 multiplier as-is', () => {
    expect(calculateRestoreFee(100, { ...baseConfig, restoreFeeMultiplier: 0.5 })).toBe('50')
  })

  it('returns "0" for a multiplier of 0 rather than using the default', () => {
    expect(calculateRestoreFee(100, { ...baseConfig, restoreFeeMultiplier: 0 })).toBe('0')
  })
})

describe('calculateRestoreFee — output format and precision', () => {
  /** Mirrors the call sites: RPC returns minResourceFee as a decimal string. */
  function feeFromRpcString(minResourceFee: string, multiplier: number): string {
    return calculateRestoreFee(parseInt(minResourceFee, 10), {
      ...baseConfig,
      restoreFeeMultiplier: multiplier,
    })
  }

  it.each([
    ['100', 3],
    ['123456789', 3],
    ['999999999999', 3],
    ['4503599627370495', 2],
    ['3002399751580330', 3],
    ['900719925474099', 10],
    ['9007199254740991', 1],
  ])('matches exact BigInt math for minResourceFee "%s" x %i', (minResourceFee, multiplier) => {
    const expected = (BigInt(minResourceFee) * BigInt(multiplier)).toString()
    expect(feeFromRpcString(minResourceFee, multiplier)).toBe(expected)
  })

  it('computes the largest safe default-multiplier fee exactly', () => {
    // floor(MAX_SAFE_INTEGER / 3) * 3 is the largest exact product at 3x.
    const maxSafeInput = Math.floor(Number.MAX_SAFE_INTEGER / RESTORE_FEE_MULTIPLIER)
    const result = calculateRestoreFee(maxSafeInput, baseConfig)

    expect(result).toBe('9007199254740990')
    expect(BigInt(result)).toBe(BigInt(maxSafeInput) * 3n)
    expect(Number.isSafeInteger(Number(result))).toBe(true)
  })

  it('never uses exponent notation for large safe-integer fees', () => {
    const result = calculateRestoreFee(1_000_000_000_000_000, {
      ...baseConfig,
      restoreFeeMultiplier: 5,
    })
    expect(result).toBe('5000000000000000')
    expect(result).toMatch(/^\d+$/)
  })

  it('returns a plain digit string for integer inputs and multipliers', () => {
    for (const fee of [0, 1, 7, 100, 12_345, 987_654_321]) {
      expect(calculateRestoreFee(fee, baseConfig)).toMatch(/^\d+$/)
    }
  })

  it('does not round when a fractional multiplier yields a fractional fee', () => {
    expect(calculateRestoreFee(100, { ...baseConfig, restoreFeeMultiplier: 1.5 })).toBe('150')
    expect(calculateRestoreFee(101, { ...baseConfig, restoreFeeMultiplier: 1.5 })).toBe('151.5')
  })
})

describe('buildRestoreCostEstimate', () => {
  it('combines the resolved multiplier and calculated fee', () => {
    expect(buildRestoreCostEstimate(100, 2, baseConfig)).toEqual({
      minResourceFee: 100,
      multiplier: 3,
      estimatedFee: '300',
      archivedKeysDetected: 2,
      wouldNeedRestore: true,
    })
  })

  it('reports no restore needed when no archived keys are detected', () => {
    expect(buildRestoreCostEstimate(0, 0, baseConfig)).toEqual({
      minResourceFee: 0,
      multiplier: 3,
      estimatedFee: '0',
      archivedKeysDetected: 0,
      wouldNeedRestore: false,
    })
  })

  it('uses a custom multiplier from config', () => {
    const estimate = buildRestoreCostEstimate(250, 1, { ...baseConfig, restoreFeeMultiplier: 4 })
    expect(estimate.multiplier).toBe(4)
    expect(estimate.estimatedFee).toBe('1000')
  })

  it('agrees with calculateRestoreFee for the same inputs', () => {
    const config = { ...baseConfig, restoreFeeMultiplier: 7 }
    expect(buildRestoreCostEstimate(123_456, 3, config).estimatedFee).toBe(
      calculateRestoreFee(123_456, config),
    )
  })
})
