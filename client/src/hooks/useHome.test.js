// ============================================================
// useHome Hook Tests (Phase 9 · the two-band home)
// ------------------------------------------------------------
// Asserts the GET path, contract validation (a valid envelope hydrates `home`;
// a malformed one surfaces an honest error instead of rendering junk), the
// error passthrough, and the pure `computeStale` derivation.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useHome, computeStale } from './useHome.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

const band = (items = []) => ({ title: 't', items, count: items.length, empty: items.length === 0 });

const validHome = {
  role: 'STRATEGIST',
  summary: '1 to decide, 0 to steer.',
  buyerBand: band([
    { id: 'verdict:d1', band: 'BUYER', type: 'VERDICT', title: 'KILL Cold #1', rationale: 'Freq over ceiling', severity: 'HIGH', evidenceRef: 'd1', humanAction: 'confirm', entityId: 'as1', impactScore: 9 },
  ]),
  strategistBand: band([]),
  loop: {
    stageStatus: [{ stage: 'PLAN', state: 'ACTIVE', lastAt: new Date().toISOString(), count: 1 }],
    closed: false, staleStages: [], loopHealth: 'HEALTHY',
    lastRunAt: new Date().toISOString(), nextRunAt: null, intervalMs: 900000,
  },
};

describe('useHome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/lumi/home and hydrates a contract-valid home', async () => {
    api.get.mockResolvedValueOnce({ data: { workspaceId: 'ws', generatedAt: 'now', ...validHome } });
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.get).toHaveBeenCalledWith('/api/lumi/home');
    expect(result.current.home?.buyerBand.items).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('rejects a malformed envelope with an honest error (no junk render)', async () => {
    api.get.mockResolvedValueOnce({ data: { role: 'STRATEGIST' } }); // missing bands + loop
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.home).toBeNull();
    expect(result.current.error?.message).toMatch(/contract validation/i);
  });

  it('surfaces a network error and nulls the home', async () => {
    api.get.mockRejectedValueOnce(new Error('No resolvable workspace.'));
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.home).toBeNull();
    expect(result.current.error?.message).toBe('No resolvable workspace.');
  });

  it('keeps a non-2xx HomeUnavailable distinct from genuine empty success', async () => {
    const failure = Object.assign(new Error('HomeUnavailable'), { httpStatus: 500 });
    api.get.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.home).toBeNull();
    expect(result.current.error).toBe(failure);
  });

  it('accepts a genuine empty Home response without an error', async () => {
    api.get.mockResolvedValueOnce({ data: {
      ...validHome,
      summary: 'Nothing needs a decision right now — the loop is quiet.',
      buyerBand: band([]),
    } });
    const { result } = renderHook(() => useHome());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.home?.buyerBand).toMatchObject({ items: [], count: 0, empty: true });
  });
});

describe('computeStale', () => {
  it('is false when the last sweep is within the interval', () => {
    expect(computeStale({ lastRunAt: new Date().toISOString(), intervalMs: 900000 })).toBe(false);
  });
  it('is true when the last sweep is older than the interval', () => {
    expect(computeStale({ lastRunAt: new Date(Date.now() - 3_600_000).toISOString(), intervalMs: 900000 })).toBe(true);
  });
  it('is false when timestamps are missing (never fabricate staleness)', () => {
    expect(computeStale({ lastRunAt: null, intervalMs: 900000 })).toBe(false);
    expect(computeStale(null)).toBe(false);
  });
});
