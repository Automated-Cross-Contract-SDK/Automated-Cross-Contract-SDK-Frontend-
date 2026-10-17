// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { SorobanResurrect } from '@soroban-resurrect/sdk'

// The SDK is mocked so this test isolates the hook package's own module scope.
vi.mock('@soroban-resurrect/sdk', () => ({
  SorobanResurrect: vi.fn(),
  isProcessingState: vi.fn(() => false),
}))

describe('SSR safety (@soroban-resurrect/react-hook)', () => {
  it('runs in a server-like environment with no DOM globals', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  it('imports every entry point without touching browser globals at module scope', async () => {
    const [index, standalone, context] = await Promise.all([
      import('../index.js'),
      import('../standalone.js'),
      import('../context.js'),
    ])

    expect(typeof index.useSorobanResurrect).toBe('function')
    expect(typeof index.SorobanResurrectProvider).toBe('function')
    expect(typeof index.useSorobanResurrectContext).toBe('function')
    expect(typeof index.useSorobanResurrectSelector).toBe('function')
    expect(typeof standalone.useSorobanResurrect).toBe('function')
    expect(typeof context.SorobanResurrectProvider).toBe('function')
    expect(typeof context.useSorobanResurrectSelector).toBe('function')
  })

  it('renders the provider without constructing the SDK on the server', async () => {
    const { SorobanResurrectProvider } = await import('../SorobanResurrectContext.js')
    const html = renderToString(
      createElement(
        SorobanResurrectProvider,
        { config: { rpcUrl: 'https://soroban-testnet.stellar.org' } },
        createElement('span', null, 'server-rendered'),
      ),
    )

    expect(html).toContain('server-rendered')
    expect(vi.mocked(SorobanResurrect)).not.toHaveBeenCalled()
  })
})
