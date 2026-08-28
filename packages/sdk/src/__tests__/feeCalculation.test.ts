import { describe, it, expect } from 'vitest'
import { calculateRestoreFee, resolveRestoreFeeMultiplier } from '../feeCalculation.js'
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