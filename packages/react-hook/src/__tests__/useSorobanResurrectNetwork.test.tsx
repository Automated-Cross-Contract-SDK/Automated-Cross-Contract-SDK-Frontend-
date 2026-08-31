import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { SorobanResurrectNetwork } from '@soroban-resurrect/sdk'
import { useSorobanResurrectNetwork } from '../useSorobanResurrectNetwork.js'

// Real module, but `create` returns a lightweight fake instance so tests never
// build a real RPC client. `listPresets` stays real — that's what we assert on.
vi.mock('@soroban-resurrect/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@soroban-resurrect/sdk')>()
  return {
    ...actual,
    SorobanResurrectNetwork: {
      listPresets: actual.SorobanResurrectNetwork.listPresets,
      getPreset: actual.SorobanResurrectNetwork.getPreset,
      create: vi.fn(() => ({
        stateInfo: { state: 'idle', message: '' },
        onStateChange: vi.fn(() => vi.fn()),
      })),
    },
  }
})

describe('useSorobanResurrectNetwork', () => {
  it('defaults to testnet and exposes the SDK preset list', () => {
    const { result } = renderHook(() => useSorobanResurrectNetwork())
    expect(result.current.network).toBe('testnet')
    expect(result.current.presets).toEqual(SorobanResurrectNetwork.listPresets())
    expect(result.current.current.name).toBe('testnet')
    expect(result.current.resurrect).toBeDefined()
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.state.state).toBe('idle')
  })

  it('respects initialNetwork', () => {
    const { result } = renderHook(() =>
      useSorobanResurrectNetwork({ initialNetwork: 'mainnet' }),
    )
    expect(result.current.network).toBe('mainnet')
    expect(result.current.current.displayName).toBe('Mainnet')
    expect(SorobanResurrectNetwork.create).toHaveBeenCalledWith('mainnet', undefined)
  })

  it('switchNetwork swaps the active network and rebuilds the instance', () => {
    const { result } = renderHook(() => useSorobanResurrectNetwork())
    const firstInstance = result.current.resurrect

    act(() => result.current.switchNetwork('futurenet'))

    expect(result.current.network).toBe('futurenet')
    expect(result.current.current.name).toBe('futurenet')
    expect(result.current.resurrect).not.toBe(firstInstance)
    expect(result.current.state.state).toBe('idle')
    expect(result.current.isProcessing).toBe(false)
  })

  it('switchNetwork to the already-active network is a no-op', () => {
    const { result } = renderHook(() => useSorobanResurrectNetwork())
    const firstInstance = result.current.resurrect
    act(() => result.current.switchNetwork('testnet'))
    expect(result.current.resurrect).toBe(firstInstance)
  })

  it('invokes onSwitch with the new network and instance', async () => {
    const onSwitch = vi.fn()
    const { result } = renderHook(() => useSorobanResurrectNetwork({ onSwitch }))

    act(() => result.current.switchNetwork('mainnet'))
    await act(async () => {
      await Promise.resolve()
    })

    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch.mock.calls[0][0]).toBe('mainnet')
    expect(onSwitch.mock.calls[0][1]).toBe(result.current.resurrect)
  })
})
