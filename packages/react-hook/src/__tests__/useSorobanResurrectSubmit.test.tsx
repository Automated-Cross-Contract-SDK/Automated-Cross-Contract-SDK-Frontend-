import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { useSorobanResurrectSubmit } from '../useSorobanResurrectSubmit.js'
import { SorobanResurrectProvider } from '../SorobanResurrectContext.js'

// Keep the real module (notably `isProcessingState`), but stub the SDK
// constructor so the `<SorobanResurrectProvider>` case doesn't touch the network.
vi.mock('@soroban-resurrect/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@soroban-resurrect/sdk')>()
  const listeners = new Set<(i: unknown) => void>()
  return {
    ...actual,
    SorobanResurrect: vi.fn().mockImplementation(() => ({
      stateInfo: { state: 'idle', message: '' },
      onStateChange: vi.fn((cb: (i: unknown) => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      }),
      submitWithRestore: vi.fn().mockResolvedValue({
        success: true,
        archivedKeysDetected: 0,
        originalTxHash: 'xyz',
      }),
      detectArchivedKeys: vi.fn().mockResolvedValue([]),
      reset: vi.fn(),
    })),
  }
})

type Listener = (info: { state: string; message: string }) => void

function makeFakeResurrect() {
  const listeners = new Set<Listener>()
  return {
    stateInfo: { state: 'idle', message: '' },
    onStateChange: vi.fn((cb: Listener) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
    emit(info: { state: string; message: string }) {
      listeners.forEach((l) => l(info))
    },
    submitWithRestore: vi.fn(),
    reset: vi.fn(),
  }
}

const tx = {} as never
const wallet = {} as never

describe('useSorobanResurrectSubmit', () => {
  let fake: ReturnType<typeof makeFakeResurrect>

  beforeEach(() => {
    fake = makeFakeResurrect()
  })

  it('starts idle with no result or error', () => {
    const { result } = renderHook(() =>
      useSorobanResurrectSubmit({ resurrect: fake as never }),
    )
    expect(result.current.result).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.isProcessing).toBe(false)
    expect(typeof result.current.submit).toBe('function')
  })

  it('subscribes to SDK state changes and reflects isProcessing', () => {
    const { result } = renderHook(() =>
      useSorobanResurrectSubmit({ resurrect: fake as never }),
    )
    expect(fake.onStateChange).toHaveBeenCalledTimes(1)

    act(() => fake.emit({ state: 'simulating', message: 'Simulating…' }))
    expect(result.current.isProcessing).toBe(true)
    expect(result.current.state.state).toBe('simulating')

    act(() => fake.emit({ state: 'success', message: 'Done' }))
    expect(result.current.isProcessing).toBe(false)
  })

  it('exposes the successful result and calls onSuccess', async () => {
    const okResult = { success: true, archivedKeysDetected: 1, originalTxHash: 'abc' }
    fake.submitWithRestore.mockResolvedValue(okResult)
    const onSuccess = vi.fn()
    const onSettled = vi.fn()

    const { result } = renderHook(() =>
      useSorobanResurrectSubmit({ resurrect: fake as never, onSuccess, onSettled }),
    )

    let returned: unknown
    await act(async () => {
      returned = await result.current.submit(tx, wallet)
    })

    expect(fake.submitWithRestore).toHaveBeenCalledWith({ transaction: tx, wallet })
    expect(returned).toEqual(okResult)
    expect(result.current.result).toEqual(okResult)
    expect(result.current.error).toBeNull()
    expect(onSuccess).toHaveBeenCalledWith(okResult)
    expect(onSettled).toHaveBeenCalledWith(okResult, null)
  })

  it('surfaces a failed ResurrectResult as error and calls onError', async () => {
    const failResult = { success: false, archivedKeysDetected: 0, error: 'boom' }
    fake.submitWithRestore.mockResolvedValue(failResult)
    const onError = vi.fn()

    const { result } = renderHook(() =>
      useSorobanResurrectSubmit({ resurrect: fake as never, onError }),
    )

    await act(async () => {
      await result.current.submit(tx, wallet)
    })

    expect(result.current.error).toBe('boom')
    expect(result.current.result).toEqual(failResult)
    expect(onError).toHaveBeenCalledWith('boom')
  })

  it('converts a thrown error into a failure result', async () => {
    fake.submitWithRestore.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() =>
      useSorobanResurrectSubmit({ resurrect: fake as never }),
    )

    let returned: { success: boolean; error?: string } = { success: true }
    await act(async () => {
      returned = await result.current.submit(tx, wallet)
    })

    expect(returned.success).toBe(false)
    expect(returned.error).toBe('network down')
    expect(result.current.error).toBe('network down')
  })

  it('reset() clears result/error and resets the SDK', async () => {
    fake.submitWithRestore.mockResolvedValue({
      success: false,
      archivedKeysDetected: 0,
      error: 'boom',
    })

    const { result } = renderHook(() =>
      useSorobanResurrectSubmit({ resurrect: fake as never }),
    )

    await act(async () => {
      await result.current.submit(tx, wallet)
    })
    expect(result.current.error).toBe('boom')

    act(() => result.current.reset())
    expect(result.current.result).toBeNull()
    expect(result.current.error).toBeNull()
    expect(fake.reset).toHaveBeenCalledTimes(1)
  })

  it('works under a <SorobanResurrectProvider> without an explicit instance', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        SorobanResurrectProvider,
        { config: { rpcUrl: 'https://soroban-testnet.stellar.org' } },
        children,
      )

    const { result } = renderHook(() => useSorobanResurrectSubmit(), { wrapper })

    let returned: { success?: boolean } = {}
    await act(async () => {
      returned = await result.current.submit(tx, wallet)
    })

    // Resolves the provider's SDK instance and drives it end to end.
    expect(vi.mocked(SorobanResurrect)).toHaveBeenCalled()
    expect(returned.success).toBe(true)
    expect(result.current.result).toMatchObject({ success: true })
    expect(result.current.error).toBeNull()
  })

  it('throws when no instance source is available (standalone misuse)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useSorobanResurrectSubmit())).toThrow(
      /no SorobanResurrect instance/i,
    )
    spy.mockRestore()
  })
})
