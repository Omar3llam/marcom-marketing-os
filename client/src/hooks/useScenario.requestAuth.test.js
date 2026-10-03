import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api.js';
import { useScenario } from './useScenario.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));
const change = { type: 'BUDGET_EXPANSION', deltaPct: 0.2 };
const empty = { data: { workspaceId: 'w1', scenario: null, message: 'No channel data to project yet.' } };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => vi.resetAllMocks());

describe('Scenario exhausted authentication and request lifecycle', () => {
  it('clears a contract-valid projection at new run start and retains null after failure', async () => {
    const range = { low: 90, expected: 100, high: 110 };
    const scenario = { scenarioType: 'BUDGET_EXPANSION', change, currency: 'USD',
      efficiencyStatus: 'VALID', efficiencyReason: null, confidence: 0.6, basis: 'Projection',
      assumptions: ['Budget change'], projections: { blendedCacMinor: range, volume: range,
        revenueMinor: range, grossProfitMinor: range, blendedRevenueEfficiencyAfter: range } };
    const pending = deferred();
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'w1', scenario } }).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(useScenario);
    await act(async () => result.current.run(change));
    expect(result.current.scenario).toEqual(scenario);
    let run;
    act(() => { run = result.current.run({ ...change, deltaPct: 0.8 }); });
    expect(result.current).toMatchObject({ scenario: null, loading: true });
    await act(async () => { pending.reject({ httpStatus: 500 }); await run; });
    expect(result.current).toMatchObject({ scenario: null, loading: false, failureReason: null });
  });

  it.each([{ httpStatus: 401 }, { response: { status: 401 } }])('retains final auth error separately from 403 refusal: %j', async (error) => {
    api.post.mockRejectedValue(error);
    const { result } = renderHook(useScenario);
    await act(async () => result.current.run(change));
    expect(result.current).toMatchObject({ scenario: null, message: null, gated: false,
      gateReason: null, loading: false, failureReason: 'AUTH_REQUIRED', error });
    expect(result.current.error).toBe(error);
    expect(api.post).toHaveBeenCalledTimes(1); // no feature-owned automatic retry
  });

  it.each([500, 503, undefined, 400, 409])('other failures keep generic behavior: %s', async (httpStatus) => {
    const error = { httpStatus }; api.post.mockRejectedValue(error);
    const { result } = renderHook(useScenario);
    await act(async () => result.current.run(change));
    expect(result.current).toMatchObject({ failureReason: null, gateReason: null, gated: false, error, scenario: null });
  });

  it.each(['message', 'error', 'permission', 'plan', 'auth'])('new pending request retracts prior %s evidence', async (prior) => {
    const errors = { error: { httpStatus: 500 }, permission: { httpStatus: 403 },
      plan: { httpStatus: 403, code: 'PLAN_REQUIRED' }, auth: { httpStatus: 401 } };
    if (prior === 'message') api.post.mockResolvedValueOnce(empty);
    else api.post.mockRejectedValueOnce(errors[prior]);
    const pending = deferred(); api.post.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(useScenario);
    await act(async () => result.current.run(change));
    let run;
    act(() => { run = result.current.run(change); });
    expect(result.current).toMatchObject({ loading: true, scenario: null, message: null,
      error: null, gated: false, gateReason: null, failureReason: null });
    await act(async () => { pending.resolve(empty); await run; });
    expect(result.current).toMatchObject({ loading: false, failureReason: null, message: empty.data.message });
  });

  it.each(['resolve', 'reject'])('completion after unmount cannot publish state: %s', async (completion) => {
    const pending = deferred(); api.post.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(useScenario);
    let run;
    act(() => { run = result.current.run(change); });
    const snapshot = result.current; unmount();
    await act(async () => {
      if (completion === 'resolve') pending.resolve(empty);
      else pending.reject({ httpStatus: 401 });
      expect(await run).toBeNull();
    });
    expect(result.current).toBe(snapshot);
    expect(snapshot).toMatchObject({ loading: true, message: null, error: null, failureReason: null });
  });
});
