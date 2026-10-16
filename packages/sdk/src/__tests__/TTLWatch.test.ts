import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../SorobanResurrectConfig.js'
import { TypedEventEmitter } from '../EventEmitter.js'
import type { ISorobanRpcClient } from '../RpcClient.js'
import type { SorobanResurrectEvents } from '../types.js'
import { SYSTEM_RUNTIME } from '../runtime.js'
import { watchTTL } from '../TTLWatch.js'

describe('watchTTL runtime injection', () => {
  it('uses the configured clock and interval scheduler and cancels its own timer', () => {
    let scheduledTimer: ReturnType<typeof globalThis.setInterval> | undefined
    const clearInterval = vi.fn()
    const runtime = {
      ...SYSTEM_RUNTIME,
      now: () => 1234,
      setInterval: vi.fn((_callback: () => void, _intervalMs: number) => {
        const timer = { unref: vi.fn() } as unknown as ReturnType<typeof globalThis.setInterval>
        scheduledTimer = timer
        return timer
      }),
      clearInterval,
    }
    const config = resolveConfig({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      runtime,
      ttlWatchIntervalMs: 25,
    }).config
    const server = {
      getLatestLedger: vi.fn(async () => ({ sequence: 100 })),
      getLedgerEntries: vi.fn(async () => ({ entries: [] })),
    } as unknown as ISorobanRpcClient
    const emitter = new TypedEventEmitter<SorobanResurrectEvents>()

    const handle = watchTTL(server, config, emitter, [])

    expect(runtime.setInterval).toHaveBeenCalledWith(expect.any(Function), 25)
    expect(handle.lastTickAt).toBe(1234)
    handle.stop()
    expect(clearInterval).toHaveBeenCalledWith(scheduledTimer)
  })
})
