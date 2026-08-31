import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'
import {
  SorobanResurrectProvider,
  useSorobanResurrectContext,
  useSorobanResurrectSelector,
} from '../SorobanResurrectContext.js'

const mockOnStateChange = vi.fn()

vi.mock('@soroban-resurrect/sdk', () => ({
  SorobanResurrect: vi.fn().mockImplementation(() => ({
    onStateChange: mockOnStateChange,
    reset: vi.fn(),
    detectArchivedKeys: vi.fn(),
    submitWithRestore: vi.fn(),
    config: { rpcUrl: 'https://test' },
  })),
  isProcessingState: (s: string) =>
    [
      'simulating',
      'signing_restore',
      'submitting_restore',
      'confirming_restore',
      'signing_original',
      'submitting_original',
    ].includes(s),
}))

const testConfig = { rpcUrl: 'https://soroban-testnet.stellar.org' }

/** Push a new SDK state through the most recently registered listener. */
function emit(info: { state: string; message: string }): void {
  const calls = mockOnStateChange.mock.calls
  calls[calls.length - 1]?.[0]?.(info)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOnStateChange.mockReturnValue(vi.fn())
})

function SelectorProbe() {
  useSorobanResurrectSelector((s) => s.isProcessing)
  return null
}

describe('useSorobanResurrectSelector', () => {
  it('throws when used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<SelectorProbe />)).toThrow(/must be used within a SorobanResurrectProvider/)
    spy.mockRestore()
  })

  it('re-renders a selector consumer only when its slice changes', () => {
    let selectorRenders = 0
    let contextRenders = 0

    function IsProcessingView() {
      selectorRenders++
      const isProcessing = useSorobanResurrectSelector((s) => s.isProcessing)
      return <span>{String(isProcessing)}</span>
    }

    function MessageView() {
      contextRenders++
      const { state } = useSorobanResurrectContext()
      return <span>{state.message}</span>
    }

    render(
      <SorobanResurrectProvider config={testConfig}>
        <IsProcessingView />
        <MessageView />
      </SorobanResurrectProvider>,
    )

    const selectorBaseline = selectorRenders
    const contextBaseline = contextRenders

    // Two message-only updates that never flip `isProcessing`.
    act(() => emit({ state: 'idle', message: 'one' }))
    act(() => emit({ state: 'idle', message: 'two' }))

    // The full-context consumer re-renders for every update...
    expect(contextRenders).toBeGreaterThan(contextBaseline)
    // ...but the selector consumer did not, because its slice was stable.
    expect(selectorRenders).toBe(selectorBaseline)

    // Now flip the selected slice.
    act(() => emit({ state: 'simulating', message: 'working' }))
    expect(selectorRenders).toBe(selectorBaseline + 1)
  })
})
