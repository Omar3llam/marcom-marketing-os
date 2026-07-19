// ============================================================
// useBlendedTruth Hook Tests — the tier-gate seam (P1.4)
// ------------------------------------------------------------
// /blended is requirePlan('GROWTH') server-side. A 403 is an honest LOCKED state
// (`gated`), NOT a failure — detection mirrors useIncrementality exactly
// (err?.response?.status === 403 → gated=true, error=null, never both set).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBlendedTruth } from './useBlendedTruth.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

// A schema-valid payload (portfolio is required by BlendedTruthSchema).
const PAYLOAD = {
  channels: [{
    channelId: 'meta', channel: 'META', name: 'Prospecting', currency: 'USD',
    spendMinor: 100000, platformRevenueMinor: 300000, actualRevenueMinor: 220000,
    blendedRevenueMinor: 220000, gapMinor: 80000, gapPct: 27,
    platformRoas: 3.0, blendedRoas: 2.2, coverage: 'RECONCILED', confidence: 'HIGH',
  }],
  portfolio: {
    spendMinor: 100000, platformRevenueMinor: 300000, blendedRevenueMinor: 220000,
    gapMinor: 80000, gapPct: 27, platformRoas: 3.0, blendedRoas: 2.2,
    reconciledCount: 1, unverifiedCount: 0,
  },
};

describe('useBlendedTruth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads + validates the blended payload from the endpoint', async () => {
    api.get.mockResolvedValue({ data: PAYLOAD });
    const { result } = renderHook(() => useBlendedTruth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.get).toHaveBeenCalledWith('/api/lumi/blended');
    expect(result.current.data?.channels).toHaveLength(1);
    expect(result.current.gated).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('treats a 403 (GROWTH tier gate) as gated — not an error', async () => {
    api.get.mockRejectedValue({ response: { status: 403 } });
    const { result } = renderHook(() => useBlendedTruth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull(); // gated=true, error=null — never both
    expect(result.current.data).toBeNull();
  });

  it('surfaces a non-403 error honestly (and stays ungated)', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } });
    const { result } = renderHook(() => useBlendedTruth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.gated).toBe(false);
  });
});
