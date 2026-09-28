import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SorobanResurrectProvider } from '../SorobanResurrectProvider';
import { useRestoreEstimate } from '../useRestoreEstimate';
import type { RestoreCostEstimate } from '@soroban-resurrect/core';

const estimateRestoreCost = vi.fn();

vi.mock('@soroban-resurrect/core', async () => {
  const actual = await vi.importActual<typeof import('@soroban-resurrect/core')>(
    '@soroban-resurrect/core',
  );
  return {
    ...actual,
    estimateRestoreCost: (...args: unknown[]) => estimateRestoreCost(...args),
  };
});

const tx = { toXDR: () => 'AAAA' } as never;

const sampleEstimate: RestoreCostEstimate = {
  totalFee: '100',
  entries: [],
} as unknown as RestoreCostEstimate;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SorobanResurrectProvider network="testnet" rpcUrl="https://rpc.testnet">
      {children}
    </SorobanResurrectProvider>
  );
}

beforeEach(() => {
  estimateRestoreCost.mockReset();
});

describe('useRestoreEstimate', () => {
  it('resolves a RestoreCostEstimate via estimateFor', async () => {
    estimateRestoreCost.mockResolvedValue(sampleEstimate);

    const { result } = renderHook(() => useRestoreEstimate(), { wrapper });

    let resolved: RestoreCostEstimate | undefined;
    await act(async () => {
      resolved = await result.current.estimateFor(tx);
    });

    expect(resolved).toEqual(sampleEstimate);
    expect(result.current.estimate).toEqual(sampleEstimate);
    expect(result.current.error).toBeNull();
    expect(result.current.isEstimating).toBe(false);
  });

  it('works standalone without a provider', async () => {
    estimateRestoreCost.mockResolvedValue(sampleEstimate);

    const { result } = renderHook(() => useRestoreEstimate());

    await act(async () => {
      await result.current.estimateFor(tx);
    });

    expect(result.current.estimate).toEqual(sampleEstimate);
  });

  it('toggles isEstimating only while a call is in flight', async () => {
    let resolveCall: (value: RestoreCostEstimate) => void = () => {};
    estimateRestoreCost.mockImplementation(
      () => new Promise<RestoreCostEstimate>((resolve) => {
        resolveCall = resolve;
      }),
    );

    const { result } = renderHook(() => useRestoreEstimate(), { wrapper });

    expect(result.current.isEstimating).toBe(false);

    let pending: Promise<RestoreCostEstimate>;
    act(() => {
      pending = result.current.estimateFor(tx);
    });

    await waitFor(() => expect(result.current.isEstimating).toBe(true));

    await act(async () => {
      resolveCall(sampleEstimate);
      await pending;
    });

    expect(result.current.isEstimating).toBe(false);
  });

  it('does not leak state across concurrent calls', async () => {
    const first: RestoreCostEstimate = { totalFee: '1', entries: [] } as unknown as RestoreCostEstimate;
    const second: RestoreCostEstimate = { totalFee: '2', entries: [] } as unknown as RestoreCostEstimate;

    let resolveFirst: (value: RestoreCostEstimate) => void = () => {};
    let resolveSecond: (value: RestoreCostEstimate) => void = () => {};

    estimateRestoreCost
      .mockImplementationOnce(
        () => new Promise<RestoreCostEstimate>((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise<RestoreCostEstimate>((resolve) => { resolveSecond = resolve; }),
      );

    const { result } = renderHook(() => useRestoreEstimate(), { wrapper });

    let firstPromise: Promise<RestoreCostEstimate>;
    let secondPromise: Promise<RestoreCostEstimate>;
    act(() => {
      firstPromise = result.current.estimateFor(tx);
      secondPromise = result.current.estimateFor(tx);
    });

    await act(async () => {
      resolveSecond(second);
      await secondPromise;
    });

    expect(result.current.estimate).toEqual(second);

    await act(async () => {
      resolveFirst(first);
      await firstPromise;
    });

    expect(result.current.estimate).toEqual(second);
    expect(result.current.isEstimating).toBe(false);
  });

  it('exposes errors as a string and keeps the last successful estimate', async () => {
    estimateRestoreCost.mockResolvedValueOnce(sampleEstimate);

    const { result } = renderHook(() => useRestoreEstimate(), { wrapper });

    await act(async () => {
      await result.current.estimateFor(tx);
    });

    expect(result.current.estimate).toEqual(sampleEstimate);

    estimateRestoreCost.mockRejectedValueOnce(new Error('boom'));

    await act(async () => {
      await expect(result.current.estimateFor(tx)).rejects.toThrow('boom');
    });

    expect(result.current.error).toBe('boom');
    expect(result.current.estimate).toEqual(sampleEstimate);
    expect(result.current.isEstimating).toBe(false);
  });

  it('reset clears estimate and error', async () => {
    estimateRestoreCost.mockResolvedValueOnce(sampleEstimate);

    const { result } = renderHook(() => useRestoreEstimate(), { wrapper });

    await act(async () => {
      await result.current.estimateFor(tx);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.estimate).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isEstimating).toBe(false);
  });
});
