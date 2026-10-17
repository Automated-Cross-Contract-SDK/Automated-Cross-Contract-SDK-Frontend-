import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, effectScope, ref, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useSorobanResurrect, type UseSorobanResurrectReturn } from '../useSorobanResurrect.js'
import { SorobanResurrect } from '@soroban-resurrect/sdk'

// ---------------------------------------------------------------------------
// Self-contained SDK mock (no importOriginal), mirroring the react-hook pattern.
// ---------------------------------------------------------------------------
const mockOnStateChange = vi.fn()
const mockOn = vi.fn()
const mockReset = vi.fn()
const mockDispose = vi.fn()
const mockDetectArchivedKeys = vi.fn()
const mockSubmitWithRestore = vi.fn()
const mockDispose = vi.fn()
const mockOn = vi.fn()

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
    on: mockOn,
    reset: mockReset,
    dispose: mockDispose,
    detectArchivedKeys: mockDetectArchivedKeys,
    submitWithRestore: mockSubmitWithRestore,
    dispose: mockDispose,
    on: mockOn,
  })),
  isProcessingState: (state: string) => PROCESSING_STATES.includes(state),
}))

const testConfig = { rpcUrl: 'https://soroban-testnet.stellar.org' }

/**
 * Mounts the composable inside a throwaway component so that Vue lifecycle
 * hooks and reactivity work as they would in a real app.
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
    mockOn.mockReturnValue(vi.fn())
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
    const { api, wrapper } = mountComposable(configRef)
    const first = api().resurrect.value

    configRef.value = { rpcUrl: 'https://other-rpc.example' }
    await nextTick()

    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledTimes(2)
    expect(mockDispose).toHaveBeenCalledTimes(1)
    expect(vi.mocked(SorobanResurrect)).toHaveBeenLastCalledWith({
      rpcUrl: 'https://other-rpc.example',
    })
    expect(api().resurrect.value).not.toBe(first)
    expect(api().state.value?.state).toBe('idle')
    wrapper.unmount()
    expect(mockDispose).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes from SDK state changes on unmount', () => {
    const unsubscribe = vi.fn()
    mockOnStateChange.mockReturnValue(unsubscribe)
    const { wrapper } = mountComposable(ref(testConfig))
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(mockDispose).toHaveBeenCalledTimes(1)
  })

  it('disposes state and event subscriptions when an effect scope ends and remounts', () => {
    const stateUnsubscribe = vi.fn()
    const eventUnsubscribe = vi.fn()
    mockOnStateChange.mockReturnValue(stateUnsubscribe)
    mockOn.mockReturnValue(eventUnsubscribe)

    const firstScope = effectScope()
    let firstApi!: UseSorobanResurrectReturn
    firstScope.run(() => {
      firstApi = useSorobanResurrect(testConfig)
    })
    firstApi.on('stateChange', vi.fn())
    firstScope.stop()

    expect(stateUnsubscribe).toHaveBeenCalledTimes(1)
    expect(eventUnsubscribe).toHaveBeenCalledTimes(1)
    expect(mockDispose).toHaveBeenCalledTimes(1)

    const secondScope = effectScope()
    secondScope.run(() => {
      useSorobanResurrect(testConfig)
    })
    secondScope.stop()

    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledTimes(2)
    expect(mockDispose).toHaveBeenCalledTimes(2)
  })

  it('delegates submitWithRestore to the SDK instance', async () => {
    const expected = { success: true, archivedKeysDetected: 0 }
    mockSubmitWithRestore.mockResolvedValue(expected)
    const { api } = mountComposable(ref(testConfig))

    const tx = {} as never
    const wallet = {} as never
    await expect(api().submitWithRestore(tx, wallet)).resolves.toBe(expected)
    expect(mockSubmitWithRestore).toHaveBeenCalledWith({
      transaction: tx,
      wallet,
      signal: expect.any(AbortSignal),
    })
  })

  it('cancel aborts active submissions', () => {
    let signal!: AbortSignal
    mockSubmitWithRestore.mockImplementation(
      (options: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal = options.signal
          signal.addEventListener('abort', () =>
            resolve({ success: false, archivedKeysDetected: 0, error: 'Operation cancelled' }),
          )
        }),
    )
    const { api } = mountComposable(ref(testConfig))

    const pending = api().submitWithRestore({} as never, {} as never)
    api().cancel()

    expect(signal.aborted).toBe(true)
    return expect(pending).resolves.toMatchObject({ success: false, error: 'Operation cancelled' })
  })

  it('unsubscribes typed event listeners on unmount', () => {
    const unsubscribe = vi.fn()
    mockOn.mockReturnValue(unsubscribe)
    const { api, wrapper } = mountComposable(ref(testConfig))

    api().on('restoreComplete', vi.fn())
    wrapper.unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('returns and retains a wallet rejection as a failed result', async () => {
    const rejected = {
      success: false,
      archivedKeysDetected: 0,
      error: 'User rejected the request',
    }
    mockSubmitWithRestore.mockResolvedValue(rejected)
    const { api } = mountComposable(ref(testConfig))

    await expect(api().submitWithRestore({} as never, {} as never)).resolves.toBe(rejected)
    expect(api().lastResult.value).toBe(rejected)
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
