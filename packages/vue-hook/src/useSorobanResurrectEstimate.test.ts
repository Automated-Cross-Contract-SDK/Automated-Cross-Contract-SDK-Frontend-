import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { useSorobanResurrectEstimate } from './useSorobanResurrectEstimate.js'
import { withSetup } from './testUtils.js'

const successSim = { transactionData: {}, minResourceFee: '100' }
const restoreSim = {
  transactionData: {},
  minResourceFee: '100',
  restorePreamble: { transactionData: {}, minResourceFee: '40' },
}
const errorSim = { error: 'simulation blew up' }

function makeFake() {
  return { simulate: vi.fn() }
}

const tx = { _tx: true } as never

describe('useSorobanResurrectEstimate', () => {
  let fake: ReturnType<typeof makeFake>

  beforeEach(() => {
    fake = makeFake()
  })

  it('is reactive and runs an estimate on mount', async () => {
    fake.simulate.mockResolvedValue(successSim)
    const [api, app] = withSetup(() =>
      useSorobanResurrectEstimate(tx, { resurrect: fake as never }),
    )

    expect(api.refreshing.value).toBe(true)
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(fake.simulate).toHaveBeenCalledWith(tx)
    expect(api.refreshing.value).toBe(false)
    expect(api.estimate.value).toMatchObject({
      minResourceFee: '100',
      needsRestore: false,
      estimatedRestoreFee: '0',
    })
    app.unmount()
  })

  it('computes the restore fee when simulation reports archived entries', async () => {
    fake.simulate.mockResolvedValue(restoreSim)
    const [api, app] = withSetup(() =>
      useSorobanResurrectEstimate(tx, { resurrect: fake as never }),
    )
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(api.estimate.value?.needsRestore).toBe(true)
    // 100 * RESTORE_FEE_MULTIPLIER (3)
    expect(api.estimate.value?.estimatedRestoreFee).toBe('300')
    app.unmount()
  })

  it('surfaces simulation errors', async () => {
    fake.simulate.mockResolvedValue(errorSim)
    const [api, app] = withSetup(() =>
      useSorobanResurrectEstimate(tx, { resurrect: fake as never }),
    )
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(api.error.value).toBe('simulation blew up')
    expect(api.estimate.value).toBeNull()
    app.unmount()
  })

  it('re-estimates when the reactive transaction changes', async () => {
    fake.simulate.mockResolvedValue(successSim)
    const txRef = ref<unknown>(null)
    const [, app] = withSetup(() =>
      useSorobanResurrectEstimate(txRef as never, { resurrect: fake as never }),
    )
    await nextTick()
    // null tx -> no call yet
    expect(fake.simulate).not.toHaveBeenCalled()

    txRef.value = tx
    await nextTick()
    await Promise.resolve()
    await nextTick()
    expect(fake.simulate).toHaveBeenCalledWith(tx)
    app.unmount()
  })

  it('does not auto-run when auto is false', async () => {
    fake.simulate.mockResolvedValue(successSim)
    const [api, app] = withSetup(() =>
      useSorobanResurrectEstimate(tx, { resurrect: fake as never, auto: false }),
    )
    await nextTick()
    await Promise.resolve()
    expect(fake.simulate).not.toHaveBeenCalled()

    await api.refresh()
    expect(fake.simulate).toHaveBeenCalledTimes(1)
    app.unmount()
  })
})
