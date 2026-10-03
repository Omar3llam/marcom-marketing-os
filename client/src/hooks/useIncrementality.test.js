// ============================================================
// useIncrementality Hook Tests — the tier-gate seam (P1.4b)
// ------------------------------------------------------------
// A 403 establishes refusal; its explicit reason establishes the instruction.
// Mapped and raw paths must retain plan, measurement-depth and generic refusal.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
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

  it.each([
    [{ httpStatus: 403, code: 'PLAN_REQUIRED' }, 'PLAN_REQUIRED'],
    [{ response: { status: 403, data: { error: 'PLAN_REQUIRED' } } }, 'PLAN_REQUIRED'],
    [{ httpStatus: 403, code: 'AUTH_ACCESS_DENIED', message: 'MeasurementGated' }, 'NOT_ENTITLED'],
    [{ response: { status: 403, data: { error: 'MeasurementGated' } } }, 'NOT_ENTITLED'],
    [{ httpStatus: 403, code: 'AUTH_ACCESS_DENIED' }, 'NOT_PERMITTED'],
    [{ response: { status: 403 } }, 'NOT_PERMITTED'],
  ])('preserves refusal evidence %j as %s', async (err, reason) => {
    api.get.mockRejectedValue(err);
    const { result } = renderHook(() => useIncrementality());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gated).toBe(true);
    expect(result.current.gateReason).toBe(reason);
    expect(result.current.error).toBeNull();
    expect(result.current.tests).toEqual([]);
  });

  it('a successful read clears a previous refusal reason', async () => {
    api.get.mockRejectedValueOnce({ httpStatus: 403, code: 'PLAN_REQUIRED' })
      .mockResolvedValue({ data: { workspaceId: 'w1', tests: [] } });
    const { result } = renderHook(() => useIncrementality());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gateReason).toBe('PLAN_REQUIRED');
    await act(() => result.current.refetch());
    expect(result.current.gated).toBe(false);
    expect(result.current.gateReason).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it.each([{ httpStatus: 500 }, new Error('offline')])('surfaces a non-403 failure %j honestly', async (err) => {
    api.get.mockRejectedValue(err);
    const { result } = renderHook(() => useIncrementality());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.gated).toBe(false);
  });

  it('contract-invalid success is an error, never a successful empty or refusal', async () => {
    api.get.mockResolvedValue({ data: { tests: 'invalid' } });
    const { result } = renderHook(() => useIncrementality());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error.message).toMatch(/contract validation/);
    expect(result.current.gated).toBe(false);
    expect(result.current.gateReason).toBeNull();
  });
});
