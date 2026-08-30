import { describe, it, expect, vi, beforeEach } from 'vitest'
import { effectScope } from 'vue'

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

import { useSorobanResurrect } from '../useSorobanResurrect.js'

beforeEach(() => {
  vi.clearAllMocks()
  mockOnStateChange.mockReturnValue(vi.fn())
})

/** Push a new SDK state through the most recently registered listener. */
function emit(info: { state: string; message: string }): void {
  const calls = mockOnStateChange.mock.calls
  calls[calls.length - 1]?.[0]?.(info)
}

/** Run the composable inside an effect scope so watchers are cleaned up. */
function withComposable<T>(fn: (r: ReturnType<typeof useSorobanResurrect>) => T): T {
  const scope = effectScope()
  try {
    return scope.run(() => fn(useSorobanResurrect({ rpcUrl: 'https://test' }))) as T
  } finally {
    scope.stop()
  }
}

describe('useSorobanResurrect (vue) derived helpers', () => {
  it('exposes isProcessing plus isIdle / isSuccess / isError as reactive refs', () => {
    withComposable((r) => {
      expect(r.isProcessing.value).toBe(false)
      expect(r.isIdle.value).toBe(true)
      expect(r.isSuccess.value).toBe(false)
      expect(r.isError.value).toBe(false)

      emit({ state: 'simulating', message: 'working' })
      expect(r.isProcessing.value).toBe(true)
      expect(r.isIdle.value).toBe(false)

      emit({ state: 'success', message: 'done' })
      expect(r.isProcessing.value).toBe(false)
      expect(r.isSuccess.value).toBe(true)

      emit({ state: 'error', message: 'boom' })
      expect(r.isError.value).toBe(true)
    })
  })

  it('matches the React hook return shape', () => {
    withComposable((r) => {
      for (const key of [
        'state',
        'isProcessing',
        'submitWithRestore',
        'detectArchivedKeys',
        'reset',
        'resurrect',
      ]) {
        expect(r).toHaveProperty(key)
      }
    })
  })
})
