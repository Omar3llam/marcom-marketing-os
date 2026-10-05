// ============================================================
// useBlendedTruth Hook Tests — the tier-gate seam (P1.4)
// ------------------------------------------------------------
// /blended is requirePlan('GROWTH') server-side. A 403 is an honest LOCKED state
// (`gated`), NOT a failure — detection mirrors useIncrementality exactly:
// status = err?.httpStatus ?? err?.response?.status → 403 → gated=true, error=null.
// The live api client rejects with a mapped AppError (.httpStatus); the raw axios
// shape (.response.status) is the backward-compat fallback (both covered below).
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

const comparison = { status: 'AVAILABLE', reason: null, windowCompatibility: 'COMPATIBLE',
  window: { windowStatus: 'EXACT', windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z' },
  currency: 'USD', platformRevenueMinor: 300000, actualRevenueMinor: 220000, gapMinor: 80000, gapPct: 80000 / 300000, gapPctReason: null, gapDenominator: 'PLATFORM_REVENUE' };
PAYLOAD.channels[0].gapPct = comparison.gapPct;
PAYLOAD.channels[0].reconciliation = comparison;
Object.assign(PAYLOAD.portfolio, { gapPct: comparison.gapPct, unavailableCount: 0, totalChannelCount: 1,
  reconciliation: { ...comparison, reconciledCount: 1, unverifiedCount: 0, unavailableCount: 0, totalChannelCount: 1 } });

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

  it('carries the backend-proven portfolio denomination into the page data', async () => {
    api.get.mockResolvedValue({ data: {
      channels: PAYLOAD.channels.map((channel) => ({ ...channel, reconciliation: { ...channel.reconciliation, currency: 'EGP' }, currency: 'EGP', monetaryStatus: 'MONETARY_VALID', monetaryReason: null })),
      portfolio: { ...PAYLOAD.portfolio, reconciliation: { ...PAYLOAD.portfolio.reconciliation, currency: 'EGP' }, currency: 'EGP', monetaryStatus: 'MONETARY_VALID', monetaryReason: null },
    } });
    const { result } = renderHook(() => useBlendedTruth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data?.portfolio.currency).toBe('EGP');
  });

  it('treats an AppError httpStatus 403 (GROWTH tier gate) as gated — not an error', async () => {
    api.get.mockRejectedValue({ httpStatus: 403 });
    const { result } = renderHook(() => useBlendedTruth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull(); // gated=true, error=null — never both
    expect(result.current.data).toBeNull();
  });

  it('also gates on a raw response.status 403 (backward-compat fallback path)', async () => {
    api.get.mockRejectedValue({ response: { status: 403 } });
    const { result } = renderHook(() => useBlendedTruth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a non-403 error honestly (and stays ungated)', async () => {
    api.get.mockRejectedValue({ httpStatus: 500 });
    const { result } = renderHook(() => useBlendedTruth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.gated).toBe(false);
  });
});
