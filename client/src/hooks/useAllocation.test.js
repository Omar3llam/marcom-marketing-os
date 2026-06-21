// ============================================================
// useAllocation Hook Tests
// ------------------------------------------------------------
// The preview-then-commit pair. Asserts: preview POSTs the budget and validates
// the plan against the contract; a null plan (no channels) surfaces an honest
// note (not an error, not a fake split); commit POSTs and returns the created-
// decision count; both surface real errors honestly.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAllocation } from './useAllocation.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

const PREVIEW = {
  goal: { type: 'GROWTH_CEILING', value: null },
  totalBudgetMinor: 5000000,
  currency: 'USD',
  allocations: [
    { channelId: 'meta', channel: 'Meta', verdict: 'SCALE', currentSpendMinor: 3000000, recommendedSpendMinor: 3500000, deltaMinor: 500000, blendedRoas: 2.4, rationale: 'higher blended ROAS' },
    { channelId: 'google', channel: 'Google', verdict: 'TRIM', currentSpendMinor: 2000000, recommendedSpendMinor: 1500000, deltaMinor: -500000, blendedRoas: 1.1, rationale: 'lower blended ROAS' },
  ],
  projected: { blendedRevenueMinor: 12000000, projectedCpaMinor: 4500, merBefore: 1.8, merAfter: 2.2 },
  reasoningTrail: ['shift toward higher blended ROAS'],
};

describe('useAllocation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preview POSTs the budget to /allocate and exposes the validated plan', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', plan: PREVIEW } });

    const { result } = renderHook(() => useAllocation());
    await act(async () => { await result.current.preview({ totalBudgetMinor: 5000000 }); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/portfolio/allocate', { totalBudgetMinor: 5000000, goal: undefined });
    expect(result.current.plan?.allocations).toHaveLength(2);
    expect(result.current.previewNote).toBeNull();
    expect(result.current.previewError).toBeNull();
  });

  it('surfaces the honest "no channels" note when the preview plan is null', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', plan: null, message: 'No connected channels to allocate.' } });

    const { result } = renderHook(() => useAllocation());
    await act(async () => { await result.current.preview({ totalBudgetMinor: 5000000 }); });

    expect(result.current.plan).toBeNull();
    expect(result.current.previewNote).toMatch(/No connected channels/i);
    expect(result.current.previewError).toBeNull();
  });

  it('flags a contract-invalid preview rather than rendering an unvalidated shape', async () => {
    api.post.mockResolvedValueOnce({ data: { plan: { allocations: 'nope' } } });
    const { result } = renderHook(() => useAllocation());
    await act(async () => { await result.current.preview({ totalBudgetMinor: 1 }); });
    expect(result.current.plan).toBeNull();
    expect(result.current.previewError?.message).toMatch(/contract validation/i);
  });

  it('commit POSTs to /allocate/commit and returns the created-decision count', async () => {
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'ws', planId: 'plan-1', decisionsCreated: 2, plan: PREVIEW } });

    const { result } = renderHook(() => useAllocation());
    let returned;
    await act(async () => { returned = await result.current.commit({ totalBudgetMinor: 5000000 }); });

    expect(api.post).toHaveBeenCalledWith('/api/lumi/portfolio/allocate/commit', { totalBudgetMinor: 5000000, goal: undefined });
    expect(returned).toEqual({ planId: 'plan-1', decisionsCreated: 2 });
    expect(result.current.committed).toEqual({ planId: 'plan-1', decisionsCreated: 2 });
  });

  it('surfaces a real commit error and returns null', async () => {
    api.post.mockRejectedValueOnce(new Error('No resolvable workspace.'));
    const { result } = renderHook(() => useAllocation());
    let returned;
    await act(async () => { returned = await result.current.commit({ totalBudgetMinor: 5000000 }); });
    expect(returned).toBeNull();
    expect(result.current.commitError?.message).toBe('No resolvable workspace.');
  });
});
