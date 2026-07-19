// ============================================================
// useScenario Hook Tests — the tier-gate seam (P1.4)
// ------------------------------------------------------------
// /scenario is requirePlan('PRO') server-side. A 403 is an honest LOCKED state
// (`gated`), NOT a failure — detection mirrors useIncrementality exactly:
// status = err?.httpStatus ?? err?.response?.status → 403 → gated=true, error=null.
// The live api client rejects with a mapped AppError (.httpStatus); the raw axios
// shape (.response.status) is the backward-compat fallback (both covered below).
// The 403-after-500 case is the invariant: a fresh lock must clear the prior
// error so the view never shows an error flash under the upgrade prompt.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useScenario } from './useScenario.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

const CHANGE = { type: 'BUDGET_EXPANSION', deltaPct: 0.2 };

describe('useScenario', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts the change to the scenario endpoint and hydrates a contract-valid response', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'w1', scenario: null, message: 'No channel data yet.' } });
    const { result } = renderHook(() => useScenario());

    await act(async () => { await result.current.run(CHANGE); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/scenario', { change: CHANGE });
    expect(result.current.gated).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.message).toBe('No channel data yet.');
  });

  it('treats an AppError httpStatus 403 (PRO tier gate) as gated — not an error', async () => {
    api.post.mockRejectedValueOnce({ httpStatus: 403 });
    const { result } = renderHook(() => useScenario());

    await act(async () => { await result.current.run(CHANGE); });

    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull(); // gated=true, error=null — never both
    expect(result.current.scenario).toBeNull();
  });

  it('also gates on a raw response.status 403 (backward-compat fallback path)', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 403 } });
    const { result } = renderHook(() => useScenario());

    await act(async () => { await result.current.run(CHANGE); });

    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a non-403 error honestly (and stays ungated)', async () => {
    api.post.mockRejectedValueOnce({ httpStatus: 500 });
    const { result } = renderHook(() => useScenario());

    await act(async () => { await result.current.run(CHANGE); });

    expect(result.current.error).toBeTruthy();
    expect(result.current.gated).toBe(false);
  });

  it('a 403 AFTER a previous 500 clears the stale error → gated=true, error=null', async () => {
    const { result } = renderHook(() => useScenario());

    api.post.mockRejectedValueOnce({ httpStatus: 500 });
    await act(async () => { await result.current.run(CHANGE); });
    expect(result.current.error).toBeTruthy();
    expect(result.current.gated).toBe(false);

    api.post.mockRejectedValueOnce({ httpStatus: 403 });
    await act(async () => { await result.current.run(CHANGE); });
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull(); // the prior 500 must not linger
  });
});
