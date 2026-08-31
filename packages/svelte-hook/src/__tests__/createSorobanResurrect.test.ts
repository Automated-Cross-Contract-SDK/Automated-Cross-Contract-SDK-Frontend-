import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get, writable } from 'svelte/store'
import { createSorobanResurrect } from '../createSorobanResurrect.js'
import { SorobanResurrect } from '@soroban-resurrect/sdk'

// ---------------------------------------------------------------------------
// Self-contained SDK mock (no importOriginal), mirroring the react-hook pattern.
// ---------------------------------------------------------------------------
const mockOnStateChange = vi.fn()
const mockReset = vi.fn()
const mockDetectArchivedKeys = vi.fn()
const mockSubmitWithRestore = vi.fn()

const PROCESSING_STATES = [
  'simulating',
  'signing_restore',
  'submitting_restore',
  'confirming_restore',
  'signing_original',
  'submitting_original',
]

vi.mock('@soroban-resurrect/sdk', () => ({
  SorobanResurrect: vi.fn().mockImplementation((config: unknown) => ({
    config,
    onStateChange: mockOnStateChange,
    reset: mockReset,
    detectArchivedKeys: mockDetectArchivedKeys,
    submitWithRestore: mockSubmitWithRestore,
  })),
  isProcessingState: (state: string) => PROCESSING_STATES.includes(state),
}))

const testConfig = { rpcUrl: 'https://soroban-testnet.stellar.org' }

describe('createSorobanResurrect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnStateChange.mockReturnValue(vi.fn())
  })

  it('initializes with an idle state store and a live SDK instance', () => {
    const store = createSorobanResurrect(writable(testConfig))
    expect(get(store.state)).toEqual({ state: 'idle', message: '' })
    expect(get(store.isProcessing)).toBe(false)
    expect(store.resurrect).toBeDefined()
    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledWith(testConfig)
    expect(mockOnStateChange).toHaveBeenCalledTimes(1)
  })

  it('updates the `state` store when the SDK emits a state change', () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })

    const store = createSorobanResurrect(writable(testConfig))
    listener({ state: 'confirming_restore', message: 'Confirming…' })

    expect(get(store.state)).toEqual({ state: 'confirming_restore', message: 'Confirming…' })
  })

  it('derives `isProcessing` as true for active states and false for idle/terminal states', () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })
    const store = createSorobanResurrect(writable(testConfig))

    for (const state of PROCESSING_STATES) {
      listener({ state, message: '' })
      expect(get(store.isProcessing)).toBe(true)
    }
    for (const state of ['idle', 'restore_needed', 'success', 'error']) {
      listener({ state, message: '' })
      expect(get(store.isProcessing)).toBe(false)
    }
  })

  it('recreates the SDK when the config store emits a new value', () => {
    const config = writable(testConfig)
    createSorobanResurrect(config)
    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledTimes(1)

    config.set({ rpcUrl: 'https://other-rpc.example' })

    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(SorobanResurrect)).toHaveBeenLastCalledWith({
      rpcUrl: 'https://other-rpc.example',
    })
  })

  it('unsubscribes the previous SDK state subscription before recreating', () => {
    const firstUnsub = vi.fn()
    const secondUnsub = vi.fn()
    mockOnStateChange.mockReturnValueOnce(firstUnsub).mockReturnValueOnce(secondUnsub)

    const config = writable(testConfig)
    createSorobanResurrect(config)
    config.set({ rpcUrl: 'https://other-rpc.example' })

    expect(firstUnsub).toHaveBeenCalledTimes(1)
  })

  it('destroy() unsubscribes both the state and the config subscriptions', () => {
    const stateUnsub = vi.fn()
    mockOnStateChange.mockReturnValue(stateUnsub)

    const config = writable(testConfig)
    const store = createSorobanResurrect(config)

    store.destroy()
    expect(stateUnsub).toHaveBeenCalledTimes(1)

    // Config subscription is gone — further emissions must not recreate the SDK.
    config.set({ rpcUrl: 'https://ignored.example' })
    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledTimes(1)
  })

  it('delegates submitWithRestore / detectArchivedKeys / reset to the SDK instance', async () => {
    const result = { success: true, archivedKeysDetected: 0 }
    const keys = [{ keyBase64: 'AAAA' }]
    mockSubmitWithRestore.mockResolvedValue(result)
    mockDetectArchivedKeys.mockResolvedValue(keys)

    const store = createSorobanResurrect(writable(testConfig))
    const tx = {} as never
    const wallet = {} as never

    await expect(store.submitWithRestore(tx, wallet)).resolves.toBe(result)
    expect(mockSubmitWithRestore).toHaveBeenCalledWith({ transaction: tx, wallet })

    await expect(store.detectArchivedKeys(tx)).resolves.toBe(keys)
    expect(mockDetectArchivedKeys).toHaveBeenCalledWith(tx)

    store.reset()
    store.reset('error')
    expect(mockReset).toHaveBeenNthCalledWith(1, undefined)
    expect(mockReset).toHaveBeenNthCalledWith(2, 'error')
  })
})
