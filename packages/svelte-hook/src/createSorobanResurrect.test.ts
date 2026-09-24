import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import { createSorobanResurrect } from './createSorobanResurrect.js'

const mockOnStateChange = vi.fn()
const mockReset = vi.fn()
const mockDetectArchivedKeys = vi.fn()
const mockSubmitWithRestore = vi.fn()
const mockSimulate = vi.fn()

let stateListener: (info: unknown) => void = () => {}

vi.mock('@soroban-resurrect/sdk', () => ({
  RESTORE_FEE_MULTIPLIER: 3,
  isProcessingState: (s: string) => s !== 'idle' && s !== 'success' && s !== 'error',
  SorobanResurrect: vi.fn().mockImplementation(() => ({
    onStateChange: (cb: typeof stateListener) => {
      stateListener = cb
      mockOnStateChange(cb)
      return vi.fn()
    },
    reset: mockReset,
    detectArchivedKeys: mockDetectArchivedKeys,
    submitWithRestore: mockSubmitWithRestore,
    simulate: mockSimulate,
  })),
}))

const config = writable({ rpcUrl: 'https://soroban-testnet.stellar.org' })

describe('createSorobanResurrect — reset / batch / derived stores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectArchivedKeys.mockResolvedValue([])
    mockSimulate.mockResolvedValue({ minResourceFee: '100' })
  })

  it('reset clears state back to idle', () => {
    const store = createSorobanResurrect(config)
    mockReset.mockImplementation(() => stateListener({ state: 'idle', message: '' }))
    stateListener({ state: 'error', message: 'boom', error: 'boom' })
    expect(get(store.state).state).toBe('error')

    store.reset()

    expect(mockReset).toHaveBeenCalledTimes(1)
    expect(get(store.state).state).toBe('idle')
    store.destroy()
  })

  it('submitBatch returns per-item result stores and a settled array', async () => {
    const store = createSorobanResurrect(config)
    mockSubmitWithRestore
      .mockResolvedValueOnce({ success: true, archivedKeysDetected: 0 })
      .mockResolvedValueOnce({ success: false, archivedKeysDetected: 1, error: 'nope' })

    const batch = store.submitBatch([{} as never, {} as never])
    expect(batch.items).toHaveLength(2)

    const results = await batch.done
    expect(results.map((r) => r.success)).toEqual([true, false])
    expect(get(batch.items[0]).status).toBe('success')
    expect(get(batch.items[1]).status).toBe('error')
    expect(get(store.lastResult)?.error).toBe('nope')
    store.destroy()
  })

  it('archivedKeys store only populates from restore_needed onward', () => {
    const store = createSorobanResurrect(config)
    expect(get(store.archivedKeys)).toEqual([])

    stateListener({
      state: 'restore_needed',
      message: 'restore',
      archivedKeys: [{ key: 'a' }, { key: 'b' }],
    })
    expect(get(store.archivedKeys)).toHaveLength(2)
    store.destroy()
  })

  it('estimate populates the feeEstimate store reactively', async () => {
    const store = createSorobanResurrect(config)
    mockDetectArchivedKeys.mockResolvedValue([{ key: 'a' }])

    const estimate = await store.estimate({} as never)

    expect(estimate.minResourceFee).toBe('100')
    expect(estimate.estimatedRestoreFee).toBe('300')
    expect(estimate.archivedKeysDetected).toBe(1)
    expect(get(store.feeEstimate)?.estimatedRestoreFee).toBe('300')
    store.destroy()
  })

  it('existing state / isProcessing stores are unaffected', () => {
    const store = createSorobanResurrect(config)
    expect(get(store.state)).toEqual({ state: 'idle', message: '' })
    expect(get(store.isProcessing)).toBe(false)

    stateListener({ state: 'simulating', message: 'Simulating...' })
    expect(get(store.isProcessing)).toBe(true)
    store.destroy()
  })
})
