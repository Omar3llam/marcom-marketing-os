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
      if (outcome === 'resolve') resolveOld({ data: { forecast: [{ entityId: 'old' }] } });
      else rejectOld(new Error('old failure'));
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.forecast).toEqual([]);
    await act(async () => {
      resolveNew({ data: { forecast: [{ entityId: 'new' }] } });
      await retry;
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.forecast).toEqual([{ entityId: 'new' }]);
  });

  it('a late older response cannot replace the latest successful retry', async () => {
    let resolveOld;
    api.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { result } = renderHook(() => useFatigueForecast());
    api.get.mockResolvedValueOnce({ data: { forecast: [{ entityId: 'new' }] } });
    await act(async () => { await result.current.refetch(); });
    await act(async () => { resolveOld({ data: { forecast: [{ entityId: 'old' }] } }); });
    expect(result.current.forecast).toEqual([{ entityId: 'new' }]);
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
