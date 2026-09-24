import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSorobanResurrectWatcher } from './useSorobanResurrectWatcher.js'
import { withSetup } from './testUtils.js'

const NO_KEYS = [] as never

function makeFake(entries: unknown[] = []) {
  return {
    getExpiringSoonEntries: vi.fn().mockResolvedValue(entries),
    submitWithRestore: vi.fn(),
  }
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('useSorobanResurrectWatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts on mount and updates expiring entries on each tick', async () => {
    const a = [{ keyBase64: 'k1', ttlLedgers: 10, isArchived: false }]
    const b = [
      { keyBase64: 'k1', ttlLedgers: 2, isArchived: false },
      { keyBase64: 'k2', ttlLedgers: 0, isArchived: true },
    ]
    const fake = makeFake()
    fake.getExpiringSoonEntries.mockResolvedValueOnce(a).mockResolvedValue(b)

    const [api, app] = withSetup(() =>
      useSorobanResurrectWatcher(NO_KEYS, {
        resurrect: fake as never,
        intervalMs: 1000,
      }),
    )

    await flush()
    expect(api.watchStatus.value).toBe('watching')
    expect(api.expiringSoon.value).toEqual(a)
    expect(api.lastCheckedAt.value).toBeTypeOf('number')

    await vi.advanceTimersByTimeAsync(1000)
    expect(api.expiringSoon.value).toEqual(b)
    expect(fake.getExpiringSoonEntries.mock.calls.length).toBeGreaterThanOrEqual(2)
    app.unmount()
  })

  it('forwards the ledgersThreshold to the SDK', async () => {
    const fake = makeFake([])
    const [, app] = withSetup(() =>
      useSorobanResurrectWatcher(NO_KEYS, {
        resurrect: fake as never,
        intervalMs: 1000,
        ledgersThreshold: 17_280,
      }),
    )
    await flush()
    expect(fake.getExpiringSoonEntries).toHaveBeenCalledWith(NO_KEYS, 17_280)
    app.unmount()
  })

  it('stops polling on unmount', async () => {
    const fake = makeFake([])
    const [, app] = withSetup(() =>
      useSorobanResurrectWatcher(NO_KEYS, {
        resurrect: fake as never,
        intervalMs: 1000,
      }),
    )
    await flush()
    const before = fake.getExpiringSoonEntries.mock.calls.length

    app.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fake.getExpiringSoonEntries.mock.calls.length).toBe(before)
  })

  it('honours autoStart:false with manual start()/stop()', async () => {
    const fake = makeFake([])
    const [api, app] = withSetup(() =>
      useSorobanResurrectWatcher(NO_KEYS, {
        resurrect: fake as never,
        intervalMs: 1000,
        autoStart: false,
      }),
    )
    await vi.advanceTimersByTimeAsync(3000)
    expect(fake.getExpiringSoonEntries).not.toHaveBeenCalled()
    expect(api.watchStatus.value).toBe('idle')

    api.start()
    await flush()
    expect(api.watchStatus.value).toBe('watching')
    expect(fake.getExpiringSoonEntries).toHaveBeenCalledTimes(1)

    api.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(fake.getExpiringSoonEntries).toHaveBeenCalledTimes(1)
    expect(api.watchStatus.value).toBe('stopped')
    app.unmount()
  })

  it('extend() runs onExtend then re-polls', async () => {
    const fake = makeFake([{ keyBase64: 'k1' }])
    const onExtend = vi.fn().mockResolvedValue(undefined)
    const [api, app] = withSetup(() =>
      useSorobanResurrectWatcher(NO_KEYS, {
        resurrect: fake as never,
        autoStart: false,
        onExtend,
      }),
    )

    const returned = await api.extend()
    expect(onExtend).toHaveBeenCalledTimes(1)
    expect(returned).toBeNull()
    expect(fake.getExpiringSoonEntries).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('extend() falls back to submitWithRestore when no onExtend', async () => {
    const okResult = { success: true, archivedKeysDetected: 1 }
    const fake = makeFake([])
    fake.submitWithRestore.mockResolvedValue(okResult)
    const [api, app] = withSetup(() =>
      useSorobanResurrectWatcher(NO_KEYS, {
        resurrect: fake as never,
        autoStart: false,
      }),
    )

    const returned = await api.extend({ id: 'tx' } as never, { id: 'w' } as never)
    expect(fake.submitWithRestore).toHaveBeenCalledWith({
      transaction: { id: 'tx' },
      wallet: { id: 'w' },
    })
    expect(returned).toEqual(okResult)
    app.unmount()
  })
})
