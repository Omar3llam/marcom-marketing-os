// ============================================================
// useEvidence — server-ranked ad-set evidence, three outcomes
// ------------------------------------------------------------
// Same load-once / retry-on-error discipline as its two sibling drill-down
// hooks. What is specific here, and what these tests are for:
//
//   • the cache key is campaign+METRIC, because the same campaign ranked by ctr
//     and by roas are different answers and a bare-id cache would serve the
//     first one forever;
//   • a REFUSAL (the request succeeded, the engine declined to rank) is not an
//     error and must never land in the error map. Conflating them renders
//     "couldn't load" over a perfectly healthy campaign.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEvidence, evidenceKey } from './useEvidence.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
const envelope = (over = {}) => ({ status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric: 'ctr', valueUnit: 'RATIO',
  gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE', source: 'META', measurementWindow: 'ROLLING_WINDOW',
  windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
  currency: null, currencyProvenance: null, rankableCount: 2, comparableCount: 2, excludedByEnvelopeCount: 0, ...over });


const RANKING = {
  comparisonEnvelope: envelope(),
  entity: { entityId: 'c1', ctr: 0.02, roas: 2 },
  objective: 'OUTCOME_SALES',
  evidence: { dimension: 'ADSET', metric: 'ctr',
    ranked: [{ entityId: 'as1', ctr: 0.01, _gap: -0.5 }, { entityId: 'as2', ctr: 0.02, _gap: 0 }],
    summary: { bottom: { entityId: 'as1', ctr: 0.01, roas: 1, _gap: -0.5 } }, dataConfidence: 0.7 },
  insufficientData: false,
  reasonKey: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((_url, { params }) => Promise.resolve({ data: {
    ...RANKING, comparisonEnvelope: envelope({ metric: params.metric, valueUnit: params.metric === 'roas' ? 'MULTIPLE' : params.metric === 'frequency' ? 'FREQUENCY' : 'RATIO',
      currency: params.metric === 'roas' ? 'EGP' : null, currencyProvenance: params.metric === 'roas' ? 'PLATFORM_REPORTED' : null }), entity: { ...RANKING.entity, roas: 2 },
    evidence: { ...RANKING.evidence, metric: params.metric,
      summary: { bottom: { ...RANKING.evidence.summary.bottom, roas: 1 } } },
  } }));
});

describe('useEvidence — a real ranking', () => {
  it('GETs the ADSET evidence route and caches the response shape unchanged', async () => {
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });

    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/c1/adsets/evidence', { params: { metric: 'ctr' } });
    const entry = result.current.byId['c1:ctr'];
    expect(entry.evidence).toEqual(RANKING.evidence);
    expect(entry.entity).toEqual(RANKING.entity);
    expect(entry.objective).toBe('OUTCOME_SALES');
    expect(entry.insufficientData).toBe(false);
    expect(entry.reasonKey).toBeNull();
    expect(result.current.errors['c1:ctr']).toBeNull();
    expect(result.current.loading['c1:ctr']).toBe(false);
  });

  it('threads the metric into the query string', async () => {
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1', { metric: 'roas' }); });
    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/c1/adsets/evidence', { params: { metric: 'roas' } });
  });
});

describe('useEvidence — the cache key', () => {
  it('is campaign + metric, so a second metric is a second request', async () => {
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1', { metric: 'ctr' }); });
    await act(async () => { await result.current.load('c1', { metric: 'roas' }); });
    // A bare-id cache would have served the ctr answer for the roas question.
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.byId['c1:ctr']).toBeDefined();
    expect(result.current.byId['c1:roas']).toBeDefined();
  });

  it('loads each campaign+metric pair at most once (StrictMode-safe)', async () => {
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    await act(async () => { await result.current.load('c1'); });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('keeps separate entries per campaign', async () => {
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    await act(async () => { await result.current.load('c2'); });
    expect(Object.keys(result.current.byId).sort()).toEqual(['c1:ctr', 'c2:ctr']);
  });

  it('exports the key builder so a consumer reads the entry it asked for', () => {
    expect(evidenceKey('c1')).toBe('c1:ctr');
    expect(evidenceKey('c1', 'frequency')).toBe('c1:frequency');
  });

  it('does nothing without a campaign id — no request, no cache entry', async () => {
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load(null); });
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.byId).toEqual({});
  });
});

// The distinction the hook exists for.
describe('useEvidence — a refusal is not an error', () => {
  it('carries insufficientData + reasonKey and leaves the error map clean', async () => {
    api.get.mockResolvedValue({
      data: { entity: { entityId: 'c1' }, objective: null, evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' },
    });
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });

    const entry = result.current.byId['c1:ctr'];
    expect(entry.insufficientData).toBe(true);
    expect(entry.reasonKey).toBe('NO_MEANINGFUL_GAP');
    expect(entry.evidence).toBeNull();
    // The request succeeded. Putting this in `errors` would render "couldn't
    // load" over a campaign whose ad sets are all performing alike.
    expect(result.current.errors['c1:ctr']).toBeNull();
  });

  it('does NOT retry a refusal — it is a real answer, not a failure', async () => {
    api.get.mockResolvedValue({ data: { evidence: null, insufficientData: true, reasonKey: 'BASELINE_UNAVAILABLE' } });
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    await act(async () => { await result.current.load('c1'); });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('treats a body with no evidence as contract failure, never as refusal', async () => {
    api.get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    expect(result.current.byId['c1:ctr']).toBeUndefined();
    expect(result.current.failures['c1:ctr'].kind).toBe('CONTRACT_INVALID');
  });

  it('a missing insufficientData flag cannot read as "there is data"', async () => {
    // `=== true` on a body that omits the flag but carries no evidence either.
    api.get.mockResolvedValue({ data: { entity: { entityId: 'c1' }, reasonKey: 'NO_MEANINGFUL_GAP' } });
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });
    expect(result.current.byId['c1:ctr']).toBeUndefined();
    expect(result.current.failures['c1:ctr'].kind).toBe('CONTRACT_INVALID');
  });
});

describe('useEvidence — a request that failed', () => {
  it('surfaces the message and writes no cache entry', async () => {
    api.get.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });

    expect(result.current.errors['c1:ctr']).toBe('Network Error');
    expect(result.current.byId['c1:ctr']).toBeUndefined();
    expect(result.current.loading['c1:ctr']).toBe(false);
  });

  it('clears the seen ref so the next expand retries', async () => {
    api.get.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1'); });

    api.get.mockResolvedValue({ data: RANKING });
    await act(async () => { await result.current.load('c1'); });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.byId['c1:ctr'].evidence).toEqual(RANKING.evidence);
    expect(result.current.errors['c1:ctr']).toBeNull();
  });

  it('retries only the failed metric, not every metric for that campaign', async () => {
    const { result } = renderHook(() => useEvidence());
    await act(async () => { await result.current.load('c1', { metric: 'ctr' }); });
    api.get.mockRejectedValue(new Error('Network Error'));
    await act(async () => { await result.current.load('c1', { metric: 'roas' }); });
    await act(async () => { await result.current.load('c1', { metric: 'ctr' }); }); // still cached
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
