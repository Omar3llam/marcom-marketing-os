// ============================================================
// useFatigueForecast — per-campaign fatigue forecast reader
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFatigueForecast } from './useFatigueForecast.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

describe('useFatigueForecast', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([4, 2.75])('carries the published ceiling %s on successful empty', async (frequencyCeiling) => {
    api.get.mockResolvedValueOnce({ data: { forecast: [], frequencyCeiling } });
    const { result } = renderHook(() => useFatigueForecast());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.frequencyCeiling).toBe(frequencyCeiling);
    expect(result.current.forecast).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it.each([undefined, null, 0, -1, NaN, Infinity, '4'])('has no fallback for invalid ceiling %s', async (frequencyCeiling) => {
    api.get.mockResolvedValueOnce({ data: { forecast: [{ entityId: 'c1' }], frequencyCeiling } });
    const { result } = renderHook(() => useFatigueForecast());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.frequencyCeiling).toBeNull();
    expect(result.current.forecast).toEqual([{ entityId: 'c1' }]);
  });

  it('does not publish ceiling from a malformed forecast envelope', async () => {
    api.get.mockResolvedValueOnce({ data: { frequencyCeiling: 4 } });
    const { result } = renderHook(() => useFatigueForecast());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.frequencyCeiling).toBeNull();
  });

  it('clears previous ceiling during retry and after failure', async () => {
    api.get.mockResolvedValueOnce({ data: { forecast: [], frequencyCeiling: 4 } });
    const { result } = renderHook(() => useFatigueForecast());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let rejectRetry;
    api.get.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRetry = reject; }));
    let retry;
    act(() => { retry = result.current.refetch(); });
    expect(result.current.frequencyCeiling).toBeNull();
    await act(async () => { rejectRetry(new Error('500')); await retry; });
    expect(result.current.frequencyCeiling).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('loads the forecast from /api/lumi/entities/fatigue', async () => {
    api.get.mockResolvedValueOnce({ data: { forecast: [{ entityId: 'c1', name: 'A', status: 'SATURATED' }] } });
    const { result } = renderHook(() => useFatigueForecast());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/fatigue');
    expect(result.current.forecast).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('exposes read failure separately from an empty forecast', async () => {
    api.get.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() => useFatigueForecast());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.forecast).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it('tolerates a malformed payload (no forecast array)', async () => {
    api.get.mockResolvedValueOnce({ data: {} });
    const { result } = renderHook(() => useFatigueForecast());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.forecast).toEqual([]);
  });

  it.each(['resolve', 'reject'])('an older request cannot %s over a newer pending retry', async (outcome) => {
    let resolveOld, rejectOld, resolveNew;
    api.get.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }));
    const { result } = renderHook(() => useFatigueForecast());
    api.get.mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    let retry;
    act(() => { retry = result.current.refetch(); });
    await act(async () => {
      if (outcome === 'resolve') resolveOld({ data: { forecast: [{ entityId: 'old' }], frequencyCeiling: 9 } });
      else rejectOld(new Error('old failure'));
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.forecast).toEqual([]);
    expect(result.current.frequencyCeiling).toBeNull();
    await act(async () => {
      resolveNew({ data: { forecast: [{ entityId: 'new' }], frequencyCeiling: 4 } });
      await retry;
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.forecast).toEqual([{ entityId: 'new' }]);
    expect(result.current.frequencyCeiling).toBe(4);
  });

  it('a late older response cannot replace the latest successful retry', async () => {
    let resolveOld;
    api.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { result } = renderHook(() => useFatigueForecast());
    api.get.mockResolvedValueOnce({ data: { forecast: [{ entityId: 'new' }], frequencyCeiling: 4 } });
    await act(async () => { await result.current.refetch(); });
    await act(async () => { resolveOld({ data: { forecast: [{ entityId: 'old' }], frequencyCeiling: 9 } }); });
    expect(result.current.forecast).toEqual([{ entityId: 'new' }]);
    expect(result.current.frequencyCeiling).toBe(4);
  });

  it('unmount invalidates pending work and retained refetch cannot start another read', async () => {
    let rejectRead;
    api.get.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    const { result, unmount } = renderHook(() => useFatigueForecast());
    const before = result.current;
    unmount();
    await act(async () => {
      rejectRead(new Error('late failure'));
      await before.refetch();
    });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(before);
  });
});
