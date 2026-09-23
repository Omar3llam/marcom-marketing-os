import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePlans } from './usePlans.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const input = {
  totalBudgetMinor: 100000, totalBudgetCurrency: 'SAR',
  periodStart: '2026-09-01', periodEnd: '2026-09-30',
};

describe('usePlans monetary creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { plans: [] } });
  });

  it('sends the visible selected denomination unchanged', async () => {
    api.post.mockResolvedValue({ data: { plan: { id: 'plan-1' } } });
    const { result } = renderHook(() => usePlans());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.createPlan(input); });
    expect(api.post).toHaveBeenCalledWith('/api/lumi/plans', input);
  });

  it('keeps a structured monetary 409 as a creation refusal, not an empty list result', async () => {
    const refusal = { httpStatus: 409, code: 'PlanMonetaryUnavailable', context: { reason: 'BUDGET_CURRENCY_MISMATCH' } };
    api.post.mockRejectedValue(refusal);
    const { result } = renderHook(() => usePlans());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let created;
    await act(async () => { created = await result.current.createPlan(input); });
    expect(created).toBeNull();
    expect(result.current.createError).toBe(refusal);
    expect(result.current.error).toBeNull();
  });
});
