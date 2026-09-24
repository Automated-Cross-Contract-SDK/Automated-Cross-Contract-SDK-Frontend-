import { describe, it, expect, vi } from 'vitest'

vi.mock('@soroban-resurrect/sdk', () => ({
  SorobanResurrect: vi.fn().mockImplementation(() => ({
    onStateChange: vi.fn(() => vi.fn()),
  })),
  isProcessingState: vi.fn(() => false),
}))

describe('SSR safety (@soroban-resurrect/vue-hook)', () => {
  it('runs in a server-like environment with no DOM globals', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  it('imports every entry point without touching browser globals at module scope', async () => {
    const [index, composable] = await Promise.all([import('../index.js'), import('../composable.js')])

    expect(typeof index.useSorobanResurrect).toBe('function')
    expect(typeof composable.useSorobanResurrect).toBe('function')
  })
})
