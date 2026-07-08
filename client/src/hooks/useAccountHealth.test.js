// ============================================================
// useAccountHealth Hook Tests
// ------------------------------------------------------------
// Reads GET /api/lumi/entities/health (the deterministic analysis engine).
// Asserts: it GETs and exposes the health payload; a 403 (CLIENT role) is treated
// as "no health to show" (null, not an error); other errors surface honestly;
// refetch re-requests.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAccountHealth } from './useAccountHealth.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

const HEALTH = {
  score: 70, label: 'GOOD',
  wastedSpend: { minor: 20000, pct: 20 },
  campaigns: [{ entityId: 'a', impactScore: 8, verdict: 'KILL' }],
};

describe('useAccountHealth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the analysis payload from the health endpoint', async () => {
    api.get.mockResolvedValue({ data: HEALTH });
    const { result } = renderHook(() => useAccountHealth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/health');
    expect(result.current.health).toEqual(HEALTH);
    expect(result.current.error).toBeNull();
  });

  it('treats a 403 (CLIENT role) as "no health to show" — null, never an error', async () => {
    api.get.mockRejectedValue({ response: { status: 403 } });
    const { result } = renderHook(() => useAccountHealth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.health).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('surfaces a non-403 error honestly', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    const { result } = renderHook(() => useAccountHealth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('refetch re-requests', async () => {
    api.get.mockResolvedValue({ data: HEALTH });
    const { result } = renderHook(() => useAccountHealth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { result.current.refetch(); });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
});
