// ============================================================
// useEvidence — the AD dimension
// ------------------------------------------------------------
// The ad-set level lives in useEvidence.test.js. Its own file so that suite
// stays inside the hook size budget, and because what is under test here is a
// property that one has no reason to hold: the SAME hook, constructed for a
// second level, reaching a differently-shaped route and keeping its own cache.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEvidence } from './useEvidence.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

const RANKING = {
  entity: { entityId: 'as-1', ctr: 0.0164 },
  objective: 'OUTCOME_SALES',
  evidence: { dimension: 'AD', metric: 'ctr',
    ranked: [{ entityId: 'ad1', ctr: 0.01, _gap: -0.4 }, { entityId: 'ad2', ctr: 0.02, _gap: 0.2 }],
    summary: { bottom: { entityId: 'ad1', ctr: 0.01, _gap: -0.4 } }, dataConfidence: 0.7 },
  insufficientData: false,
  reasonKey: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((_url, { params }) => Promise.resolve({ data: {
    ...RANKING, entity: { ...RANKING.entity, frequency: 2 },
    evidence: { ...RANKING.evidence, metric: params.metric,
      summary: { bottom: { ...RANKING.evidence.summary.bottom, frequency: 4 } } },
  } }));
});

// ── One implementation, two levels ──────────────────────────
// The server exposes the same evidence contract for the ads of an ad set. The
// dimension is fixed at CONSTRUCTION, which is what gives each level its own
// byId and `seen` maps — the alternative (a dimension argument on load) would
// put a campaign id and an ad-set id in one cache.
describe('useEvidence — the AD dimension', () => {
  it('GETs the ad route, which is not the ad-set route with a segment swapped', async () => {
    // The two paths differ in SHAPE: the ad-level one is three segments so it
    // cannot collide with the ad-set LIST route. Building either by
    // concatenation would encode a symmetry the server does not have.
    const { result } = renderHook(() => useEvidence({ dimension: 'ad' }));
    await act(async () => { await result.current.load('as-1'); });
    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/as-1/evidence', { params: { metric: 'ctr' } });
  });

  it('threads the metric the same way', async () => {
    const { result } = renderHook(() => useEvidence({ dimension: 'ad' }));
    await act(async () => { await result.current.load('as-1', { metric: 'frequency' }); });
    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/as-1/evidence', { params: { metric: 'frequency' } });
  });

  it('keeps the same three-outcome contract', async () => {
    api.get.mockResolvedValue({
      data: { entity: { entityId: 'as-1' }, evidence: null, insufficientData: true, reasonKey: 'INSUFFICIENT_REPORTING_ADS' },
    });
    const { result } = renderHook(() => useEvidence({ dimension: 'ad' }));
    await act(async () => { await result.current.load('as-1'); });
    expect(result.current.byId['as-1:ctr'].reasonKey).toBe('INSUFFICIENT_REPORTING_ADS');
    expect(result.current.errors['as-1:ctr']).toBeNull();
  });

  it('defaults to the ad-set route, so every existing caller is unchanged', async () => {
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/c1/adsets/evidence', { params: { metric: 'ctr' } });
  });

  // A typo must not build a URL out of `undefined`. It degrades to the original
  // level rather than to a request that 404s on a path no route serves.
  it('degrades an unknown dimension to the ad-set route', async () => {
    const { result } = renderHook(() => useEvidence({ dimension: 'placement' }));
    await act(async () => { await result.current.load('c1'); });
    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/c1/adsets/evidence', { params: { metric: 'ctr' } });
  });

  // Two instances, two maps. The property that makes a bare `${id}:${metric}`
  // key safe at both levels.
  it('two instances share no cache', async () => {
    const adSetLevel = renderHook(() => useEvidence());
    const adLevel = renderHook(() => useEvidence({ dimension: 'ad' }));
    await act(async () => { await adSetLevel.result.current.load('x1'); });
    expect(adSetLevel.result.current.byId['x1:ctr']).toBeDefined();
    expect(adLevel.result.current.byId['x1:ctr']).toBeUndefined();
    // Same id at the other level is a second, real request — not a cache hit.
    await act(async () => { await adLevel.result.current.load('x1'); });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
