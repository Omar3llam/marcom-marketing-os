import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api.js';
import { useEntityDrillDown } from './useEntityDrillDown.js';
import { useAdsDrillDown } from './useAdsDrillDown.js';
import { useEvidence } from './useEvidence.js';
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
const wrapper = ({ children }) => <StrictMode>{children}</StrictMode>;

describe.each([
  ['ad sets', useEntityDrillDown, 'adSets'], ['ads', useAdsDrillDown, 'children'],
])('%s envelope/read behavior', (_name, hook, list) => {
  it.each([
    {}, { entity: {} }, { entity: {}, [list]: null }, { entity: {}, [list]: 'bad' },
    { entity: null, [list]: [] }, { entity: [], [list]: [] }, { [list]: [] },
    { entity: {}, [list]: [], objective: 1 },
  ])('invalid response %j publishes failure, never empty, and stays cached', async (payload) => {
    api.get.mockResolvedValue({ data: payload }); const { result } = renderHook(hook, { wrapper });
    await act(async () => result.current.load('parent'));
    const entry = result.current.byId.parent;
    const failure = list === 'adSets' ? entry.failure : result.current.failures.parent;
    expect(failure).toEqual({ kind: 'CONTRACT_INVALID', retryable: false });
    if (list === 'adSets') { expect(entry.adSets).toBeNull(); expect(entry.error).toBeTruthy(); expect(entry.loading).toBe(false); }
    else { expect(entry).toBeUndefined(); expect(result.current.errors.parent).toBeTruthy(); expect(result.current.loading.parent).toBe(false); }
    await act(async () => result.current.load('parent')); expect(api.get).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, 'OUTCOME_SALES'])('valid empty with objective %s remains usable', async (objective) => {
    const payload = { entity: { arbitrary: true }, [list]: [], ...(objective === undefined ? {} : { objective }) };
    api.get.mockResolvedValue({ data: payload }); const { result } = renderHook(hook);
    await act(async () => result.current.load('parent'));
    expect(result.current.byId.parent[list]).toEqual([]);
    expect(result.current.byId.parent.entity).toEqual(payload.entity);
  });
  it('retains pending/cache ownership and retries genuine 404 without fabricated empty', async () => {
    let reject;
    api.get.mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
    const { result } = renderHook(hook, { wrapper }); let pending;
    act(() => { pending = result.current.load('parent'); result.current.load('parent'); });
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => { reject({ httpStatus: 404, message: 'Not found' }); await pending; });
    api.get.mockResolvedValue({ data: { entity: {}, [list]: [] } });
    await act(async () => result.current.load('parent'));
    expect(api.get).toHaveBeenCalledTimes(2); expect(result.current.byId.parent[list]).toEqual([]);
  });
});

describe.each(['ad', 'adset'])('%s evidence HTTP ownership preserves successful refusal', (dimension) => {
  it.each([{ httpStatus: 403 }, { response: { status: 403 } }])('permission %j remains non-retryable', async (error) => {
    api.get.mockRejectedValue(error); const { result } = renderHook(() => useEvidence({ dimension }), { wrapper });
    await act(async () => result.current.load('parent'));
    expect(result.current.failures['parent:ctr']).toEqual({ kind: 'NOT_PERMITTED', retryable: false });
    expect(result.current.byId['parent:ctr']).toBeUndefined();
    await act(async () => result.current.load('parent')); expect(api.get).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, 408, 429, 500, 503])('HTTP %s recovers into analytical refusal', async (httpStatus) => {
    api.get.mockRejectedValueOnce({ httpStatus, message: 'Unavailable' });
    const payload = { entity: {}, evidence: null, insufficientData: true, reasonKey: 'NO_MEANINGFUL_GAP' };
    api.get.mockResolvedValueOnce({ data: payload }); const { result } = renderHook(() => useEvidence({ dimension }));
    await act(async () => result.current.load('parent'));
    expect(result.current.failures['parent:ctr']).toEqual({ kind: 'UNAVAILABLE', retryable: true });
    await act(async () => result.current.load('parent'));
    expect(result.current.byId['parent:ctr']).toMatchObject(payload);
    expect(result.current.failures['parent:ctr']).toBeNull(); expect(result.current.errors['parent:ctr']).toBeNull();
  });
});
