import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, ref, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useSorobanResurrect, type UseSorobanResurrectReturn } from '../useSorobanResurrect.js'
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

/**
 * Mounts the composable inside a throwaway component so that Vue lifecycle
 * hooks (`onUnmounted`) and reactivity work as they would in a real app.
 */
function mountComposable(configRef: Ref<{ rpcUrl: string }>) {
  let api!: UseSorobanResurrectReturn
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useSorobanResurrect(configRef)
        return () => null
      },
    }),
  )
  return { api: () => api, wrapper }
}

describe('useSorobanResurrect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnStateChange.mockReturnValue(vi.fn())
  })

  it('starts in the idle state with an SDK instance', () => {
    const { api } = mountComposable(ref(testConfig))
    expect(api().state.value?.state).toBe('idle')
    expect(api().state.value?.message).toBe('')
    expect(api().isProcessing.value).toBe(false)
    expect(api().resurrect.value).not.toBeNull()
    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledWith(testConfig)
  })

  it('subscribes to SDK state changes on mount', () => {
    mountComposable(ref(testConfig))
    expect(mockOnStateChange).toHaveBeenCalledTimes(1)
  })

  it('reflects listener updates on `state` and derives `isProcessing`', async () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })

    const { api } = mountComposable(ref(testConfig))

    listener({ state: 'simulating', message: 'Simulating…' })
    await nextTick()
    expect(api().state.value?.state).toBe('simulating')
    expect(api().state.value?.message).toBe('Simulating…')
    expect(api().isProcessing.value).toBe(true)

    listener({ state: 'success', message: 'Done' })
    await nextTick()
    expect(api().isProcessing.value).toBe(false)
  })

  it('`isProcessing` is true for every processing state and false for terminal states', async () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })
    const { api } = mountComposable(ref(testConfig))

    for (const state of PROCESSING_STATES) {
      listener({ state, message: '' })
      await nextTick()
      expect(api().isProcessing.value).toBe(true)
    }

    for (const state of ['idle', 'restore_needed', 'success', 'error']) {
      listener({ state, message: '' })
      await nextTick()
      expect(api().isProcessing.value).toBe(false)
    }
  })

  it('recreates the SDK and resets state when the config changes', async () => {
    const configRef = ref(testConfig)
    const { api } = mountComposable(configRef)
    const first = api().resurrect.value

    configRef.value = { rpcUrl: 'https://other-rpc.example' }
    await nextTick()

    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(SorobanResurrect)).toHaveBeenLastCalledWith({
      rpcUrl: 'https://other-rpc.example',
    })
    expect(api().resurrect.value).not.toBe(first)
    expect(api().state.value?.state).toBe('idle')
  })

  it('unsubscribes from SDK state changes on unmount', () => {
    const unsubscribe = vi.fn()
    mockOnStateChange.mockReturnValue(unsubscribe)
    const { wrapper } = mountComposable(ref(testConfig))
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('delegates submitWithRestore to the SDK instance', async () => {
    const expected = { success: true, archivedKeysDetected: 0 }
    mockSubmitWithRestore.mockResolvedValue(expected)
    const { api } = mountComposable(ref(testConfig))

    const tx = {} as never
    const wallet = {} as never
    await expect(api().submitWithRestore(tx, wallet)).resolves.toBe(expected)
    expect(mockSubmitWithRestore).toHaveBeenCalledWith({ transaction: tx, wallet })
  })

  it('delegates detectArchivedKeys to the SDK instance', async () => {
    const keys = [{ keyBase64: 'AAAA' }]
    mockDetectArchivedKeys.mockResolvedValue(keys)
    const { api } = mountComposable(ref(testConfig))

    const tx = {} as never
    await expect(api().detectArchivedKeys(tx)).resolves.toBe(keys)
    expect(mockDetectArchivedKeys).toHaveBeenCalledWith(tx)
  })

  it('delegates reset (with optional fromState) to the SDK instance', () => {
    const { api } = mountComposable(ref(testConfig))
    api().reset()
    api().reset('error')
    expect(mockReset).toHaveBeenNthCalledWith(1, undefined)
    expect(mockReset).toHaveBeenNthCalledWith(2, 'error')
  })
})
