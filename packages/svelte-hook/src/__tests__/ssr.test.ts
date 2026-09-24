import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get, readable } from 'svelte/store'

const mockOnStateChange = vi.fn()

vi.mock('@soroban-resurrect/sdk', () => ({
  SorobanResurrect: vi.fn().mockImplementation(() => ({
    onStateChange: mockOnStateChange,
    reset: vi.fn(),
    detectArchivedKeys: vi.fn(),
    submitWithRestore: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  mockOnStateChange.mockReturnValue(vi.fn())
})

/** Push a new SDK state through the most recently registered listener. */
function emit(info: { state: string; message: string }): void {
  const calls = mockOnStateChange.mock.calls
  calls[calls.length - 1]?.[0]?.(info)
}

describe('SSR safety (@soroban-resurrect/svelte-hook)', () => {
  it('runs in a server-like environment with no DOM globals', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  it('imports every entry point without touching browser globals at module scope', async () => {
    const [index, store] = await Promise.all([import('../index.js'), import('../store.js')])

    expect(typeof index.createSorobanResurrect).toBe('function')
    expect(typeof store.createSorobanResurrect).toBe('function')
  })

  it('creates a working store in a node environment', async () => {
    const { createSorobanResurrect } = await import('../index.js')
    const s = createSorobanResurrect(readable({ rpcUrl: 'https://test' }))

    expect(get(s.isProcessing)).toBe(false)
    emit({ state: 'simulating', message: 'working' })
    expect(get(s.isProcessing)).toBe(true)

    s.destroy()
  })
})
