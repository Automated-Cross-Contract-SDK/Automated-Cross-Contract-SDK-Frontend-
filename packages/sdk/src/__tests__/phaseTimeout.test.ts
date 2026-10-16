import { describe, expect, it } from 'vitest'
import { withPhaseTimeout } from '../phaseTimeout.js'

describe('withPhaseTimeout', () => {
  it('returns a completed operation', async () => {
    await expect(withPhaseTimeout(Promise.resolve('ok'), 100, 'Wallet signing')).resolves.toBe('ok')
  })

  it('reports which phase exceeded its timeout', async () => {
    await expect(withPhaseTimeout(new Promise(() => {}), 5, 'Wallet signing')).rejects.toThrow(
      'Wallet signing timed out after 5ms',
    )
  })

  it('preserves errors from the timed operation', async () => {
    await expect(
      withPhaseTimeout(Promise.reject(new Error('RPC failed')), 100, 'Simulation'),
    ).rejects.toThrow('RPC failed')
  })
})
