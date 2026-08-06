// ============================================================
// useAdsDrillDown — lazy ad drill-down, load-once, retry-on-error
// ------------------------------------------------------------
// Asserts: load() GETs the ads route and exposes { entity, children }; a SECOND
// load for the same ad-set makes NO new request (the `seen` ref — this is also
// what makes it StrictMode-safe); a failure surfaces as an error AND clears the
// ref so the next expand retries; and the cache never grows an `adSets` key —
// this hook shares no state with useEntityDrillDown, so a campaign id and an
// ad-set id can never collide in one map.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAdsDrillDown } from './useAdsDrillDown.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));

const AD = { entityId: 'ad1', name: 'Carousel #4', platformCreatedTime: '2026-05-01T00:00:00.000Z', spendMinor: 10000 };

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { entity: { id: 'as1' }, children: [AD] } });
});

describe('useAdsDrillDown', () => {
  it('GETs the ads route and caches { entity, children } under the ad-set id', async () => {
    const { result } = renderHook(() => useAdsDrillDown());
    await act(async () => { await result.current.load('as1'); });

    expect(api.get).toHaveBeenCalledWith('/api/lumi/entities/as1/ads');
    expect(result.current.byId.as1.entity).toEqual({ id: 'as1' });
    expect(result.current.byId.as1.children).toEqual([AD]);
    expect(result.current.errors.as1).toBeNull();
    expect(result.current.loading.as1).toBe(false);
  });

  it('loads each ad-set at most once — the second call is a no-op (StrictMode-safe)', async () => {
    const { result } = renderHook(() => useAdsDrillDown());
    await act(async () => { await result.current.load('as1'); });
    await act(async () => { await result.current.load('as1'); });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('keeps separate cache entries per ad-set', async () => {
    const { result } = renderHook(() => useAdsDrillDown());
    api.get.mockResolvedValueOnce({ data: { entity: { id: 'as1' }, children: [AD] } });
    api.get.mockResolvedValueOnce({ data: { entity: { id: 'as2' }, children: [] } });
    await act(async () => { await result.current.load('as1'); });
    await act(async () => { await result.current.load('as2'); });
    expect(result.current.byId.as1.children).toHaveLength(1);
    expect(result.current.byId.as2.children).toEqual([]);
  });

  it('ignores a falsy id', async () => {
    const { result } = renderHook(() => useAdsDrillDown());
    await act(async () => { await result.current.load(undefined); });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('surfaces a failure as an error and never a fabricated empty drill-down', async () => {
    api.get.mockRejectedValue(new Error('Request failed with status code 404'));
    const { result } = renderHook(() => useAdsDrillDown());
    await act(async () => { await result.current.load('as1'); });

    expect(result.current.errors.as1).toMatch(/404/);
    expect(result.current.byId.as1).toBeUndefined(); // no children[] invented
    expect(result.current.loading.as1).toBe(false);
  });

  it('clears the seen ref on error so the next expand retries', async () => {
    api.get.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAdsDrillDown());
    await act(async () => { await result.current.load('as1'); });
    expect(result.current.errors.as1).toBe('boom');

    await act(async () => { await result.current.load('as1'); });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.byId.as1.children).toEqual([AD]);
  });

  // A body without children[] is a contract break, not a request failure — it
  // degrades to an empty expansion rather than throwing.
  it('degrades a malformed body to an empty children array', async () => {
    api.get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useAdsDrillDown());
    await act(async () => { await result.current.load('as1'); });
    expect(result.current.byId.as1.children).toEqual([]);
    // null, NOT a synthesised { id } row. The route returns the ad-set's real
    // measured row; substituting a metric-less object for a missing one would
    // let a consumer read entity.ctr as undefined and render it as a figure.
    expect(result.current.byId.as1.entity).toBeNull();
    expect(result.current.byId.as1.objective).toBeNull();
  });

  it('carries the ad-set row and objective the route now returns', async () => {
    api.get.mockResolvedValue({
      data: {
        entity: { entityId: 'as1', name: 'Broad', ctr: 0.021, spendMinor: 90000 },
        objective: 'OUTCOME_SALES',
        children: [],
      },
    });
    const { result } = renderHook(() => useAdsDrillDown());
    await act(async () => { await result.current.load('as1'); });
    expect(result.current.byId.as1.entity).toMatchObject({ entityId: 'as1', ctr: 0.021 });
    expect(result.current.byId.as1.objective).toBe('OUTCOME_SALES');
  });

  // Sibling isolation: this hook must never write the ad-set-level payload key.
  it('never writes an adSets key — no shared state with useEntityDrillDown', async () => {
    const { result } = renderHook(() => useAdsDrillDown());
    await act(async () => { await result.current.load('as1'); });
    expect(result.current.byId.as1.adSets).toBeUndefined();
    expect(Object.keys(result.current.byId.as1).sort()).toEqual(['children', 'entity', 'objective']);
  });
});
