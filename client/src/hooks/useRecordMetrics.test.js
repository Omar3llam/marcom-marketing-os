// ============================================================
// useRecordMetrics Hook Tests
// ------------------------------------------------------------
// The manual observed-counts entry for a RUNNING test. Asserts: it POSTs the
// variants[] payload to /tests/:id/metrics and returns { updated }; it no-ops
// (no request) without a test id or with an empty variants[]; and it surfaces
// a real error honestly while returning null.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRecordMetrics } from './useRecordMetrics.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

const ROWS = [
  { variantId: 'v-a', impressions: 5000, clicks: 120, conversions: 8, spendMinor: 5000, revenueMinor: 12000 },
  { variantId: 'v-b', impressions: 5200, clicks: 160, conversions: 11, spendMinor: 5000, revenueMinor: 18000 },
];

describe('useRecordMetrics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the variants payload to /tests/:id/metrics and returns the updated count', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', updated: 2 } });

    const { result } = renderHook(() => useRecordMetrics());
    let returned;
    await act(async () => { returned = await result.current.record('t-1', ROWS); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/tests/t-1/metrics', { variants: ROWS });
    expect(returned).toEqual({ workspaceId: 'ws', updated: 2 });
    expect(result.current.error).toBeNull();
  });

  it('no-ops (no request) without a test id', async () => {
    const { result } = renderHook(() => useRecordMetrics());
    let returned;
    await act(async () => { returned = await result.current.record(undefined, ROWS); });
    expect(returned).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('no-ops (no request) with an empty variants[]', async () => {
    const { result } = renderHook(() => useRecordMetrics());
    let returned;
    await act(async () => { returned = await result.current.record('t-1', []); });
    expect(returned).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('surfaces a real error and returns null', async () => {
    api.post.mockRejectedValueOnce(new Error('No resolvable workspace.'));
    const { result } = renderHook(() => useRecordMetrics());
    let returned;
    await act(async () => { returned = await result.current.record('t-1', ROWS); });
    expect(returned).toBeNull();
    expect(result.current.error?.message).toBe('No resolvable workspace.');
  });
});
