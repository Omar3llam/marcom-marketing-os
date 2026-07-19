// ============================================================
// useIncrementality Hook Tests — the tier-gate seam (P1.4b)
// ------------------------------------------------------------
// /incrementality is Agency/Enterprise depth (tier-gated server-side). A 403 is
// an honest LOCKED state (`gated`), NOT a failure. Detection is:
//   status = err?.httpStatus ?? err?.response?.status
// The live api client rejects with a mapped AppError (.httpStatus); the raw axios
// shape (.response.status) is the backward-compat fallback. Both must gate.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useIncrementality } from './useIncrementality.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

describe('useIncrementality — tier gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the holdout list from the endpoint (ungated happy path)', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'w1', tests: [] } });
    const { result } = renderHook(() => useIncrementality());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.get).toHaveBeenCalledWith('/api/lumi/incrementality');
    expect(result.current.gated).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('treats an AppError httpStatus 403 as gated — tests=[], error=null', async () => {
    api.get.mockRejectedValue({ httpStatus: 403 });
    const { result } = renderHook(() => useIncrementality());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull(); // gated=true, error=null — never both
    expect(result.current.tests).toEqual([]);
  });

  it('also gates on a raw response.status 403 (backward-compat fallback path)', async () => {
    api.get.mockRejectedValue({ response: { status: 403 } });
    const { result } = renderHook(() => useIncrementality());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a non-403 error honestly (and stays ungated)', async () => {
    api.get.mockRejectedValue({ httpStatus: 500 });
    const { result } = renderHook(() => useIncrementality());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.gated).toBe(false);
  });
});
