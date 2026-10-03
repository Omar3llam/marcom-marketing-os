import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { api } from '@/lib/api.js';
import { useScenario } from './useScenario.js';
import { scenarioGateReason } from './scenarioGateReason.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));
const change = { type: 'BUDGET_EXPANSION', deltaPct: 0.2 };
beforeEach(() => vi.resetAllMocks());

describe('Scenario refusal evidence', () => {
  it.each([
    { response: { status: 403, data: { error: 'RoleForbidden', role: 'BUYER' } } },
    { httpStatus: 403, code: 'AUTH_ACCESS_DENIED' },
  ])('role refusal %j establishes permission rather than a plan gate', async (err) => {
    api.post.mockRejectedValueOnce(err);
    const { result } = renderHook(useScenario);
    await act(async () => { await result.current.run(change); });
    expect(result.current).toMatchObject({ gated: true, gateReason: 'NOT_PERMITTED', error: null, scenario: null });
  });

  it.each([
    { httpStatus: 403, code: 'PLAN_REQUIRED' },
    { response: { status: 403, data: { error: 'PLAN_REQUIRED' } } },
  ])('explicit plan refusal %j retains its billing meaning', async (err) => {
    api.post.mockRejectedValueOnce(err);
    const { result } = renderHook(useScenario);
    await act(async () => { await result.current.run(change); });
    expect(result.current).toMatchObject({ gated: true, gateReason: 'PLAN_REQUIRED', error: null });
  });

  it.each([
    { httpStatus: 503, code: 'RoleUnavailable' }, { httpStatus: 500, code: 'ScenarioUnavailable' },
    { response: { status: 400, data: { error: 'BadScenario' } } },
    { httpStatus: 409, code: 'NoWorkspace' }, new Error('offline'),
  ])('non-403 failure %j retains the error without a refusal reason', async (err) => {
    api.post.mockRejectedValueOnce(err);
    const { result } = renderHook(useScenario);
    await act(async () => { await result.current.run(change); });
    expect(result.current).toMatchObject({ gated: false, gateReason: null, error: err });
  });

  it.each(['PLAN_REQUIRED', 'NOT_PERMITTED'])('new run retracts %s while pending and accepts successful empty', async (gateReason) => {
    const { result } = renderHook(useScenario);
    expect(api.post).not.toHaveBeenCalled();
    api.post.mockRejectedValueOnce({ httpStatus: 403, code: gateReason === 'PLAN_REQUIRED' ? gateReason : 'AUTH_ACCESS_DENIED' });
    await act(async () => { await result.current.run(change); });
    expect(result.current.gateReason).toBe(gateReason);
    let resolve, pending;
    api.post.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    act(() => { pending = result.current.run(change); });
    expect(result.current).toMatchObject({ loading: true, gated: false, gateReason: null, error: null, message: null });
    await act(async () => { resolve({ data: { workspaceId: 'w1', scenario: null, message: 'No channel data to project yet.' } }); await pending; });
    expect(result.current).toMatchObject({ loading: false, gated: false, gateReason: null, error: null,
      scenario: null, message: 'No channel data to project yet.' });
  });

  it('never parses human-readable plan claims and prefers raw backend tokens', () => {
    expect(scenarioGateReason({ message: 'PLAN_REQUIRED Upgrade to PRO' })).toBe('NOT_PERMITTED');
    expect(scenarioGateReason({ code: 'PLAN_REQUIRED', response: { data: { error: 'RoleForbidden' } } })).toBe('NOT_PERMITTED');
  });

  it('a successful projection preserves exact ranges, currency, assumptions and memory basis', async () => {
    const range = { low: 1, expected: 2, high: 3 };
    const scenario = { scenarioType: change.type, change, currency: 'EGP', efficiencyStatus: 'VALID', efficiencyReason: null,
      economicsStatus: 'CONFIGURED', projections: { blendedCacMinor: range, volume: range, revenueMinor: range,
        grossProfitMinor: range, blendedRevenueEfficiencyAfter: range }, assumptions: ['Explicit assumption'], confidence: 0.6,
      basis: 'Declared basis', memoryBasis: [{ patternId: 'p1', kind: 'KILL', statement: 'Stored evidence', accuracy: 0.5 }] };
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'w1', scenario } });
    const { result } = renderHook(useScenario);
    await act(async () => { await result.current.run(change); });
    expect(result.current.scenario).toEqual(scenario);
    expect(result.current).toMatchObject({ gated: false, gateReason: null, error: null, message: null });
  });
});
