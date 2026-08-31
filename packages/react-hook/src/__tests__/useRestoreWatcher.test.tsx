import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRestoreWatcher } from '../useRestoreWatcher.js'

const NO_KEYS = [] as never

function makeFake(entries: unknown[] = []) {
  return {
    getExpiringSoonEntries: vi.fn().mockResolvedValue(entries),
    submitWithRestore: vi.fn(),
  }
}

describe('useRestoreWatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('polls on mount and updates expiringSoon on each tick', async () => {
    const a = [{ keyBase64: 'k1', isArchived: false, ttlLedgers: 12 }]
    const b = [
      { keyBase64: 'k1', isArchived: false, ttlLedgers: 4 },
      { keyBase64: 'k2', isArchived: true, ttlLedgers: 0 },
    ]
    const fake = makeFake()
    fake.getExpiringSoonEntries
      .mockResolvedValueOnce(a)
      .mockResolvedValue(b)

    const { result } = renderHook(() =>
      useRestoreWatcher(NO_KEYS, { resurrect: fake as never, intervalMs: 1000 }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.watchStatus).toBe('watching')
    expect(result.current.expiringSoon).toEqual(a)
    expect(result.current.lastCheckedAt).toBeTypeOf('number')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.expiringSoon).toEqual(b)
    expect(fake.getExpiringSoonEntries.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('forwards the ledgersThreshold to the SDK', async () => {
    const fake = makeFake([])
    renderHook(() =>
      useRestoreWatcher(NO_KEYS, {
        resurrect: fake as never,
        intervalMs: 1000,
        ledgersThreshold: 17_280,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fake.getExpiringSoonEntries).toHaveBeenCalledWith(NO_KEYS, 17_280)
  })

  it('fires onExpiringSoon once when entries first appear', async () => {
    const fake = makeFake()
    fake.getExpiringSoonEntries
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ keyBase64: 'k1' }])
      .mockResolvedValue([{ keyBase64: 'k1' }])
    const onExpiringSoon = vi.fn()

    renderHook(() =>
      useRestoreWatcher(NO_KEYS, {
        resurrect: fake as never,
        intervalMs: 1000,
        onExpiringSoon,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onExpiringSoon).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onExpiringSoon).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the component unmounts', async () => {
    const fake = makeFake([])
    const { unmount } = renderHook(() =>
      useRestoreWatcher(NO_KEYS, { resurrect: fake as never, intervalMs: 1000 }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const callsBefore = fake.getExpiringSoonEntries.mock.calls.length

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(fake.getExpiringSoonEntries.mock.calls.length).toBe(callsBefore)
  })

  it('honours autoStart:false and start()/stop()', async () => {
    const fake = makeFake([])
    const { result } = renderHook(() =>
      useRestoreWatcher(NO_KEYS, {
        resurrect: fake as never,
        intervalMs: 1000,
        autoStart: false,
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(fake.getExpiringSoonEntries).not.toHaveBeenCalled()
    expect(result.current.watchStatus).toBe('idle')

    act(() => result.current.start())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.watchStatus).toBe('watching')
    expect(fake.getExpiringSoonEntries).toHaveBeenCalledTimes(1)

    act(() => result.current.stop())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(fake.getExpiringSoonEntries).toHaveBeenCalledTimes(1)
    expect(result.current.watchStatus).toBe('stopped')
  })

  it('extend() runs the custom onExtend routine then re-polls', async () => {
    const fake = makeFake([{ keyBase64: 'k1' }])
    const onExtend = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useRestoreWatcher(NO_KEYS, {
        resurrect: fake as never,
        autoStart: false,
        onExtend,
      }),
    )

    let returned: unknown = 'unset'
    await act(async () => {
      returned = await result.current.extend()
    })
    expect(onExtend).toHaveBeenCalledTimes(1)
    expect(returned).toBeNull()
    expect(fake.getExpiringSoonEntries).toHaveBeenCalledTimes(1) // the re-poll
  })

  it('extend() falls back to submitWithRestore when no onExtend is given', async () => {
    const okResult = { success: true, archivedKeysDetected: 1 }
    const fake = makeFake([])
    fake.submitWithRestore.mockResolvedValue(okResult)
    const { result } = renderHook(() =>
      useRestoreWatcher(NO_KEYS, { resurrect: fake as never, autoStart: false }),
    )

    let returned: unknown
    await act(async () => {
      returned = await result.current.extend({ id: 'tx' } as never, { id: 'w' } as never)
    })
    expect(fake.submitWithRestore).toHaveBeenCalledWith({
      transaction: { id: 'tx' },
      wallet: { id: 'w' },
    })
    expect(returned).toEqual(okResult)
  })
})
