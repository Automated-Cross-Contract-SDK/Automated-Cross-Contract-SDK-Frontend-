import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rpc } from '@stellar/stellar-sdk'
import { waitForTransaction } from '../Restorer.js'

function makeMockServer(): rpc.Server {
  return {
    getTransaction: vi.fn(),
  } as unknown as rpc.Server
}

describe('waitForTransaction — timeout and retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('NOT_FOUND for extended period', () => {
    it('keeps polling through repeated NOT_FOUND responses until a terminal status arrives', async () => {
      const server = makeMockServer()
      let calls = 0
      vi.mocked(server.getTransaction).mockImplementation(async () => {
        calls++
        if (calls < 8) {
          return { status: rpc.Api.GetTransactionStatus.NOT_FOUND } as never
        }
        return { status: rpc.Api.GetTransactionStatus.SUCCESS } as never
      })

      const promise = waitForTransaction(server, 'hash', 1000, 60_000)
      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
      expect(calls).toBe(8)
    })

    it('throws a descriptive timeout error when the status stays NOT_FOUND for the entire poll window', async () => {
      const server = makeMockServer()
      vi.mocked(server.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as never)

      const promise = waitForTransaction(server, 'hash', 100, 2000)
      const assertion = expect(promise).rejects.toThrow(
        'Transaction hash did not complete within 2000ms',
      )
      await vi.runAllTimersAsync()
      await assertion

      expect(server.getTransaction).toHaveBeenCalled()
    })
  })

  describe('RPC unavailable during polling', () => {
    it('propagates the error immediately when the RPC endpoint fails on the first poll', async () => {
      const server = makeMockServer()
      vi.mocked(server.getTransaction).mockRejectedValue(new Error('RPC unavailable'))

      await expect(waitForTransaction(server, 'hash', 100, 5000)).rejects.toThrow(
        'RPC unavailable',
      )
      expect(server.getTransaction).toHaveBeenCalledTimes(1)
    })

    it('propagates the error from a later poll if the RPC becomes unavailable mid-polling', async () => {
      const server = makeMockServer()
      let calls = 0
      vi.mocked(server.getTransaction).mockImplementation(async () => {
        calls++
        if (calls < 3) {
          return { status: rpc.Api.GetTransactionStatus.NOT_FOUND } as never
        }
        throw new Error('connection reset')
      })

      const promise = waitForTransaction(server, 'hash', 100, 60_000)
      const assertion = expect(promise).rejects.toThrow('connection reset')
      await vi.runAllTimersAsync()
      await assertion

      expect(calls).toBe(3)
    })
  })

  describe('exponential backoff with jitter', () => {
    it('doubles the delay each attempt and caps it at pollIntervalMs, with jitter in [0.5x, 1x] of the base delay', async () => {
      const server = makeMockServer()
      let calls = 0
      vi.mocked(server.getTransaction).mockImplementation(async () => {
        calls++
        if (calls <= 6) {
          return { status: rpc.Api.GetTransactionStatus.NOT_FOUND } as never
        }
        return { status: rpc.Api.GetTransactionStatus.SUCCESS } as never
      })

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      const promise = waitForTransaction(server, 'hash', 1000, 60_000)
      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)

      const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms as number)
      expect(delays.length).toBe(6)

      // attempt 1: exponentialDelay = 100 * 2^1 = 200, uncapped
      expect(delays[0]).toBeGreaterThanOrEqual(200 * 0.5)
      expect(delays[0]).toBeLessThanOrEqual(200)
      // attempt 2: 100 * 2^2 = 400
      expect(delays[1]).toBeGreaterThanOrEqual(400 * 0.5)
      expect(delays[1]).toBeLessThanOrEqual(400)
      // attempt 3: 100 * 2^3 = 800
      expect(delays[2]).toBeGreaterThanOrEqual(800 * 0.5)
      expect(delays[2]).toBeLessThanOrEqual(800)
      // attempt 4+: 100 * 2^4 = 1600, capped at pollIntervalMs (1000)
      for (let i = 3; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(1000 * 0.5)
        expect(delays[i]).toBeLessThanOrEqual(1000)
      }
    })

    it('caps backoff delay at a custom pollIntervalMs', async () => {
      const server = makeMockServer()
      let calls = 0
      vi.mocked(server.getTransaction).mockImplementation(async () => {
        calls++
        if (calls <= 4) {
          return { status: rpc.Api.GetTransactionStatus.NOT_FOUND } as never
        }
        return { status: rpc.Api.GetTransactionStatus.SUCCESS } as never
      })

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      const promise = waitForTransaction(server, 'hash', 250, 60_000)
      await vi.runAllTimersAsync()
      await promise

      const delays = setTimeoutSpy.mock.calls.map(([, ms]) => ms as number)
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(250)
      }
    })
  })

  describe('configurable timeout limits', () => {
    it('honors a short custom pollTimeoutMs and times out sooner than the default', async () => {
      const server = makeMockServer()
      vi.mocked(server.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as never)

      const promise = waitForTransaction(server, 'hash', 50, 150)
      const assertion = expect(promise).rejects.toThrow('did not complete within 150ms')
      await vi.runAllTimersAsync()
      await assertion
    })

    it('honors a longer custom pollTimeoutMs, allowing more polling attempts before timing out', async () => {
      const server = makeMockServer()
      vi.mocked(server.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as never)

      const promise = waitForTransaction(server, 'hash', 50, 10_000)
      const assertion = expect(promise).rejects.toThrow('did not complete within 10000ms')
      await vi.runAllTimersAsync()
      await assertion

      expect(vi.mocked(server.getTransaction).mock.calls.length).toBeGreaterThan(5)
    })

    it('uses the documented defaults (1000ms interval, 60000ms timeout) when not provided', async () => {
      const server = makeMockServer()
      vi.mocked(server.getTransaction).mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      } as never)

      const promise = waitForTransaction(server, 'hash')
      const assertion = expect(promise).rejects.toThrow('did not complete within 60000ms')
      await vi.runAllTimersAsync()
      await assertion
    })
  })
})
