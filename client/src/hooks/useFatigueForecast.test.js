// ============================================================
// useFatigueForecast — per-campaign fatigue forecast reader
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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

  it('degrades to an empty forecast on error', async () => {
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
});
