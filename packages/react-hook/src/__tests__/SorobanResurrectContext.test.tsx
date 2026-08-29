import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, screen, act } from '@testing-library/react'
import React from 'react'
import {
  SorobanResurrectProvider,
  useSorobanResurrectContext,
} from '../SorobanResurrectContext.js'
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const mockOnStateChange = vi.fn()
const mockReset = vi.fn()
const mockDetectArchivedKeys = vi.fn()
const mockSubmitWithRestore = vi.fn()

vi.mock('@soroban-resurrect/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@soroban-resurrect/sdk')>()
  return {
    ...actual,
    SorobanResurrect: vi.fn().mockImplementation(() => ({
      onStateChange: mockOnStateChange,
      reset: mockReset,
      detectArchivedKeys: mockDetectArchivedKeys,
      submitWithRestore: mockSubmitWithRestore,
      config: { rpcUrl: 'https://test' },
      state: 'idle',
    })),
  }
})

const testConfig = { rpcUrl: 'https://soroban-testnet.stellar.org' }

describe('SorobanResurrectProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnStateChange.mockReturnValue(vi.fn())
  })

  it('provides context to children', () => {
    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    expect(result.current).toBeDefined()
    expect(result.current.config).toEqual(testConfig)
  })

  it('throws when hook is used outside provider', () => {
    const { result } = renderHook(() => {
      try {
        useSorobanResurrectContext()
        return null
      } catch (e) {
        return e
      }
    })

    expect(result.current).toBeInstanceOf(Error)
    expect((result.current as Error).message).toContain('must be used within')
  })

  it('initializes with idle state', () => {
    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    expect(result.current.state.state).toBe('idle')
    expect(result.current.state.message).toBe('')
    expect(result.current.isProcessing).toBe(false)
  })

  it('subscribes to state changes on mount', () => {
    renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    expect(mockOnStateChange).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    mockOnStateChange.mockReturnValue(unsubscribe)

    const { unmount } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('updates state when listener fires', async () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })

    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    act(() => {
      listener({ state: 'simulating', message: 'Simulating...' })
    })

    expect(result.current.state.state).toBe('simulating')
    expect(result.current.state.message).toBe('Simulating...')
  })

  it('marks as processing during active states', () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })

    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

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

    // Non-processing states
    act(() => {
      listener({ state: 'idle', message: '' })
    })
    expect(result.current.isProcessing).toBe(false)

    act(() => {
      listener({ state: 'success', message: '' })
    })
    expect(result.current.isProcessing).toBe(false)

    act(() => {
      listener({ state: 'error', message: '' })
    })
    expect(result.current.isProcessing).toBe(false)
  })

  it('provides resurrection instance', () => {
    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    expect(result.current.resurrect).toBeDefined()
    expect(result.current.resurrect).not.toBeNull()
  })

  it('passes the exact SDK instance created for the provider to consumers', () => {
    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    const mockedConstructor = vi.mocked(SorobanResurrect)
    expect(mockedConstructor).toHaveBeenCalledWith(testConfig)
    expect(result.current.resurrect).toBe(mockedConstructor.mock.results[0].value)
  })

  it('exposes submitWithRestore method', async () => {
    mockSubmitWithRestore.mockResolvedValue({
      success: true,
      originalTxHash: 'test-hash',
      archivedKeysDetected: 0,
    })

    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    const mockTx = { toXDR: () => 'mock-xdr' } as any
    const mockWallet = {
      isConnected: vi.fn(),
      getPublicKey: vi.fn(),
      signTransaction: vi.fn(),
    }

    const resultValue = await result.current.submitWithRestore(mockTx, mockWallet)

    expect(resultValue.success).toBe(true)
    expect(mockSubmitWithRestore).toHaveBeenCalledWith({ transaction: mockTx, wallet: mockWallet })
  })

  it('exposes detectArchivedKeys method', async () => {
    mockDetectArchivedKeys.mockResolvedValue([])

    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    const mockTx = { toXDR: () => 'mock-xdr' } as any
    const archivedKeys = await result.current.detectArchivedKeys(mockTx)

    expect(archivedKeys).toEqual([])
    expect(mockDetectArchivedKeys).toHaveBeenCalledWith(mockTx)
  })

  it('exposes reset method', () => {
    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    act(() => {
      result.current.reset()
    })

    expect(mockReset).toHaveBeenCalledTimes(1)
    expect(result.current.state.state).toBe('idle')
  })

  it('provides config through context', () => {
    mockOnStateChange.mockReturnValue(vi.fn())

    const TestComponent = () => {
      const ctx = useSorobanResurrectContext()
      return <div>{ctx.config.rpcUrl}</div>
    }

    const { container } = render(
      <SorobanResurrectProvider config={testConfig}>
        <TestComponent />
      </SorobanResurrectProvider>,
    )

    expect(container.textContent).toContain(testConfig.rpcUrl)
  })

  it('does not recreate SDK when config is unchanged', () => {
    const { rerender } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    rerender()
    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalledTimes(1)
  })

  it('multiple children can access the same context', () => {
    const TestChild = () => {
      const ctx = useSorobanResurrectContext()
      return <div>{ctx.state.state}</div>
    }

    const { container } = render(
      <SorobanResurrectProvider config={testConfig}>
        <TestChild />
        <TestChild />
      </SorobanResurrectProvider>,
    )

    const divs = container.querySelectorAll('div')
    expect(divs.length).toBe(2)
    expect(divs[0].textContent).toBe('idle')
    expect(divs[1].textContent).toBe('idle')
  })

  it('handles submitWithRestore failure', async () => {
    mockSubmitWithRestore.mockResolvedValue({
      success: false,
      error: 'Test error',
      archivedKeysDetected: 0,
    })

    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    const mockTx = { toXDR: () => 'mock-xdr' } as any
    const mockWallet = {
      isConnected: vi.fn(),
      getPublicKey: vi.fn(),
      signTransaction: vi.fn(),
    }

    const resultValue = await result.current.submitWithRestore(mockTx, mockWallet)

    expect(resultValue.success).toBe(false)
    expect(resultValue.error).toBe('Test error')
  })

  it('state reflects all restore phases', async () => {
    let listener: (info: { state: string; message: string }) => void = () => {}
    mockOnStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb
      return vi.fn()
    })

    const { result } = renderHook(() => useSorobanResurrectContext(), {
      wrapper: ({ children }) => (
        <SorobanResurrectProvider config={testConfig}>{children}</SorobanResurrectProvider>
      ),
    })

    const phases = [
      { state: 'simulating', message: 'Simulating transaction...' },
      { state: 'restore_needed', message: 'Archived entries detected' },
      { state: 'signing_restore', message: 'Signing restore transaction...' },
      { state: 'submitting_restore', message: 'Submitting restore transaction...' },
      { state: 'confirming_restore', message: 'Confirming restore...' },
      { state: 'signing_original', message: 'Signing original transaction...' },
      { state: 'submitting_original', message: 'Submitting original transaction...' },
      { state: 'success', message: 'Success!' },
    ]

    for (const phase of phases) {
      act(() => {
        listener(phase)
      })
      expect(result.current.state.state).toBe(phase.state)
      expect(result.current.state.message).toBe(phase.message)
    }
  })
})
