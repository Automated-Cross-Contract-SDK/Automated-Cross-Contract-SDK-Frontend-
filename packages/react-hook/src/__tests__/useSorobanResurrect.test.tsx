import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { useSorobanResurrect } from '../useSorobanResurrect.js'

const mockOnStateChange = vi.fn()
const mockReset = vi.fn()
const mockDetectArchivedKeys = vi.fn()
const mockSubmitWithRestore = vi.fn()

vi.mock('@soroban-resurrect/sdk', () => ({
  SorobanResurrect: vi.fn().mockImplementation(() => ({
    onStateChange: mockOnStateChange,
    reset: mockReset,
    detectArchivedKeys: mockDetectArchivedKeys,
    submitWithRestore: mockSubmitWithRestore,
    config: { rpcUrl: 'https://test' },
    state: 'idle',
  })),
}))

const testConfig = { rpcUrl: 'https://soroban-testnet.stellar.org' }

describe('useSorobanResurrect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnStateChange.mockReturnValue(vi.fn())
  })

  it('returns an instance with default idle state', () => {
    const { result } = renderHook(() => useSorobanResurrect({ config: testConfig }))
    expect(result.current.state.state).toBe('idle')
    expect(result.current.state.message).toBe('')
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.resurrect).toBeDefined()
  })

  it('subscribes to state changes on mount', () => {
    renderHook(() => useSorobanResurrect({ config: testConfig }))
    expect(mockOnStateChange).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    mockOnStateChange.mockReturnValue(unsubscribe)
    const { unmount } = renderHook(() => useSorobanResurrect({ config: testConfig }))
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('updates state when listener fires', async () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })

    const { result } = renderHook(() => useSorobanResurrect({ config: testConfig }))

    act(() => {
      listener({ state: 'simulating', message: 'Simulating...' })
    })

    expect(result.current.state.state).toBe('simulating')
    expect(result.current.state.message).toBe('Simulating...')
  })

  it('exposes reset that clears both SDK and React state', () => {
    const { result } = renderHook(() => useSorobanResurrect({ config: testConfig }))
    act(() => {
      result.current.reset()
    })
    expect(mockReset).toHaveBeenCalledTimes(1)
    expect(result.current.state.state).toBe('idle')
  })

  it('recreates SDK instance when config changes', () => {
    const { SorobanResurrect } = require('@soroban-resurrect/sdk')
    const { rerender } = renderHook(
      (config: { rpcUrl: string }) => useSorobanResurrect({ config }),
      { initialProps: testConfig },
    )
    const instance1 = (SorobanResurrect as ReturnType<typeof vi.fn>).mock.results[0].value

    rerender({ rpcUrl: 'https://other-rpc.com' })
    const instance2 = (SorobanResurrect as ReturnType<typeof vi.fn>).mock.results[1].value

    expect(instance1).not.toBe(instance2)
  })

  it('does not recreate SDK when config is unchanged', () => {
    const { SorobanResurrect } = require('@soroban-resurrect/sdk')
    const { rerender } = renderHook(
      (config: { rpcUrl: string }) => useSorobanResurrect({ config }),
      { initialProps: testConfig },
    )

    rerender(testConfig)
    expect(SorobanResurrect).toHaveBeenCalledTimes(1)
  })

  it('isProcessing reflects running states', () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })

    const { result } = renderHook(() => useSorobanResurrect({ config: testConfig }))

    expect(result.current.isProcessing).toBe(false)

    const processingStates = [
      'simulating',
      'signing_restore',
      'submitting_restore',
      'confirming_restore',
      'signing_original',
      'submitting_original',
    ]

    for (const s of processingStates) {
      act(() => {
        listener({ state: s, message: '' })
      })
      expect(result.current.isProcessing).toBe(true)
    }
  })
})
