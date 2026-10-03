import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: vi.fn() }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useConnections.js', () => ({ useConnections: vi.fn() }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: vi.fn() }));
vi.mock('@/hooks/useHome.js', () => ({ useHome: vi.fn() }));
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useAccuracy.js', () => ({ useAccuracy: vi.fn() }));
vi.mock('@/hooks/useAccountAggregate.js', () => ({ useAccountAggregate: vi.fn() }));
vi.mock('../useDismissals.js', () => ({ useDismissals: vi.fn() }));
vi.mock('@/hooks/useCollabRole.js', async (importOriginal) => ({
  ...await importOriginal(), useCollabRole: vi.fn(),
}));

import { useOverviewModel } from '../useOverviewModel.js';
import { OVERVIEW_STATUS, ACCOUNT_STATE } from '../overviewState.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useHome } from '@/hooks/useHome.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccuracy } from '@/hooks/useAccuracy.js';
import { useAccountAggregate } from '@/hooks/useAccountAggregate.js';
import { useDismissals } from '../useDismissals.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';

const campaign = { entityId: 'c1', name: 'Live', currency: 'EGP', spendMinor: 1000 };
const health = { campaigns: [{ entityId: 'c1', verdict: 'KILL', impactScore: 8 }], score: 42, label: 'FAIR' };
const failed = new Error('read failed');
const model = () => renderHook(() => useOverviewModel()).result.current;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.mockReturnValue({ workspace: { name: 'Acme', currency: 'EGP' }, loading: false, error: null, status: 'PRESENT' });
  useConnectorCampaigns.mockReturnValue({ campaigns: [campaign], loading: false, error: null });
  useAccountHealth.mockReturnValue({ health, loading: false, error: null, forbidden: false });
  useConnectorVerdicts.mockReturnValue({ verdicts: [], loading: false, error: null });
  useAccountAggregate.mockReturnValue({ response: { available: false, aggregate: null }, loading: false, error: null, forbidden: false });
  useConnections.mockReturnValue({ data: { connections: [] }, loading: false, error: null });
  useAccuracy.mockReturnValue({ surface: null, loading: false, error: null });
  useHome.mockReturnValue({ home: null, isStale: false, error: null });
  useCollabRole.mockReturnValue({ role: 'STRATEGIST' });
  useDismissals.mockReturnValue({ firstRunFlag: false, dismissed: new Set(), dismiss: vi.fn() });
});

describe('Overview source composition', () => {
  it('is COMPLETE with successful core and optional reads', () => {
    expect(model()).toMatchObject({ overviewStatus: OVERVIEW_STATUS.COMPLETE, accountState: ACCOUNT_STATE.ACTION_REQUIRED, coreUsable: true });
  });

  it('is EMPTY only after confirmed zero campaigns', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null });
    useAccountHealth.mockReturnValue({ health: { campaigns: [], score: null, label: null }, loading: false, error: null });
    expect(model()).toMatchObject({ overviewStatus: OVERVIEW_STATUS.EMPTY, accountState: ACCOUNT_STATE.LEARNING });
  });

  it.each([
    ['campaigns', () => useConnectorCampaigns.mockReturnValue({ campaigns: [campaign], loading: false, error: failed })],
    ['health', () => useAccountHealth.mockReturnValue({ health, loading: false, error: failed })],
  ])('%s failure with cached data cannot select a core account state', (_source, breakRead) => {
    breakRead();
    const view = model();
    expect(view.overviewStatus).toBe(OVERVIEW_STATUS.ERROR);
    expect(view.accountState).toBe(ACCOUNT_STATE.UNREADABLE);
    expect(view.coreUsable).toBe(false);
    expect(view.bands).toBeNull();
    expect(view.killCount).toBeNull();
    expect(view.kpis.health).toBeNull();
    expect(view.plan.interrupt).toBeFalsy();
  });

  it.each([
    ['verdicts', () => useConnectorVerdicts.mockReturnValue({ verdicts: [], loading: false, error: failed })],
    ['aggregate', () => useAccountAggregate.mockReturnValue({ response: null, loading: false, error: failed, forbidden: false })],
    ['connections', () => useConnections.mockReturnValue({ data: null, loading: false, error: failed })],
    ['accuracy', () => useAccuracy.mockReturnValue({ surface: null, loading: false, error: failed })],
  ])('%s failure yields PARTIAL and retains health-derived action', (_source, breakRead) => {
    breakRead();
    const view = model();
    expect(view.overviewStatus).toBe(OVERVIEW_STATUS.PARTIAL);
    expect(view.accountState).toBe(ACCOUNT_STATE.ACTION_REQUIRED);
    expect(view.bands.actNowTotal).toBe(1);
    expect(view.coreUsable).toBe(true);
  });

  it('a failed verdict read is not a confirmed zero-verdict answer', () => {
    useConnectorVerdicts.mockReturnValue({ verdicts: [], loading: false, error: failed });
    const view = model();
    expect(view.overviewStatus).toBe(OVERVIEW_STATUS.PARTIAL);
    expect(view.bands.actNowTotal).toBe(1); // independently confirmed by health
    expect(view.bands.actNow[0].decisionId).toBeNull(); // no fabricated persisted decision
  });

  it('an unexpected aggregate refusal remains incomplete for an operating role', () => {
    useAccountAggregate.mockReturnValue({ response: null, loading: false, error: null, forbidden: true });
    expect(model().overviewStatus).toBe(OVERVIEW_STATUS.PARTIAL);
  });

  it('connection failure suppresses the unverified connect instruction', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null });
    useAccountHealth.mockReturnValue({ health: { campaigns: [] }, loading: false, error: null });
    useConnections.mockReturnValue({ data: null, loading: false, error: failed });
    expect(model().plan.interrupt).toBeNull();
  });

  it('briefing failure makes the composition PARTIAL while suppressing AI prose', () => {
    useHome.mockReturnValue({ home: { aiInsight: 'Old narration' }, isStale: false, error: failed });
    const view = model();
    expect(view.overviewStatus).toBe(OVERVIEW_STATUS.PARTIAL);
    expect(view.insight).toBeNull();
    expect(view.accountState).toBe(ACCOUNT_STATE.ACTION_REQUIRED);
  });

  it.each([
    { httpStatus: 409, code: 'RoleNotConfigured', context: { roleReason: 'ROLE_UNSET' } },
    { httpStatus: 503, context: { roleReason: 'ROLE_LOOKUP_FAILED' } },
    { httpStatus: 503, context: { roleReason: 'ROLE_UNKNOWN' } },
    { httpStatus: 403 },
  ])('Home access/configuration failure %j remains optional PARTIAL with valid core', (details) => {
    const error = Object.assign(new Error('Home unavailable'), details);
    useHome.mockReturnValue({ home: null, isStale: false, error, refetch: vi.fn() });
    expect(model()).toMatchObject({ overviewStatus: OVERVIEW_STATUS.PARTIAL, coreUsable: true,
      accountState: ACCOUNT_STATE.ACTION_REQUIRED, insight: null });
  });

  it.each(['Fresh narration', null])('a successful Home read with insight %s remains COMPLETE', (aiInsight) => {
    useHome.mockReturnValue({ home: { aiInsight }, isStale: false, error: null });
    expect(model()).toMatchObject({ overviewStatus: OVERVIEW_STATUS.COMPLETE, insight: aiInsight });
  });

  it('stale Home suppresses insight without implying a read failure', () => {
    useHome.mockReturnValue({ home: { aiInsight: 'Stale narration' }, isStale: true, error: null });
    expect(model()).toMatchObject({ overviewStatus: OVERVIEW_STATUS.COMPLETE, insight: null });
  });

  it('Home failure retains established health, decisions and monetary KPI evidence', () => {
    useAccountAggregate.mockReturnValue({ response: { available: true, aggregate: {
      currency: 'EGP', currencyStatus: 'SINGLE',
      population: { campaignCount: 1, measurementWindow: 'CUMULATIVE_30D', boundsStatus: 'REPORTED' },
      spend: { minor: 1000, unavailable: null },
      acquisition: { conversions: 1, blendedCpaMinor: 1000, unavailable: null },
    } }, loading: false, error: null, forbidden: false });
    const before = model();
    expect(before.kpis).toMatchObject({ spend: 10, cpa: 10, currency: 'EGP', health: 42 });
    useHome.mockReturnValue({ home: null, isStale: false, error: failed });
    const after = model();
    expect(after.overviewStatus).toBe(OVERVIEW_STATUS.PARTIAL);
    expect(after.health).toBe(health);
    expect(after.bands).toEqual(before.bands);
    expect(after.bands.actNowTotal).toBe(1);
    expect(after.kpis).toEqual(before.kpis);
    expect(after.plan.interrupt).toBe(before.plan.interrupt);
    expect(after.coreUsable).toBe(true);
  });

  it('Home and another optional failure remain PARTIAL', () => {
    useHome.mockReturnValue({ home: null, isStale: false, error: failed });
    useAccuracy.mockReturnValue({ surface: null, loading: false, error: failed });
    expect(model()).toMatchObject({ overviewStatus: OVERVIEW_STATUS.PARTIAL, coreUsable: true });
  });

  it.each([
    ['required error', { health: null, loading: false, error: failed, forbidden: false }, OVERVIEW_STATUS.ERROR],
    ['required unavailable', { health: null, loading: false, error: null, forbidden: true }, OVERVIEW_STATUS.UNAVAILABLE],
    ['core loading', { health: null, loading: true, error: null, forbidden: false }, OVERVIEW_STATUS.LOADING],
  ])('%s outranks a Home failure', (_name, healthRead, expected) => {
    useHome.mockReturnValue({ home: null, isStale: false, error: failed });
    useAccountHealth.mockReturnValue(healthRead);
    expect(model().overviewStatus).toBe(expected);
  });

  it('an empty core plus Home failure is PARTIAL according to existing precedence', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null });
    useAccountHealth.mockReturnValue({ health: { campaigns: [] }, loading: false, error: null });
    useHome.mockReturnValue({ home: null, isStale: false, error: failed });
    expect(model()).toMatchObject({ overviewStatus: OVERVIEW_STATUS.PARTIAL, accountState: ACCOUNT_STATE.LEARNING, coreUsable: true });
  });

  it('COMPLETE → Home-only PARTIAL → COMPLETE recovery retains existing source-specific retry', () => {
    const homeRetry = vi.fn();
    const coreRetry = vi.fn();
    useConnectorCampaigns.mockReturnValue({ campaigns: [campaign], loading: false, error: null, refetch: coreRetry });
    useHome.mockReturnValue({ home: { aiInsight: 'Fresh' }, isStale: false, error: null, refetch: homeRetry });
    const { result, rerender } = renderHook(() => useOverviewModel());
    expect(result.current).toMatchObject({ overviewStatus: OVERVIEW_STATUS.COMPLETE, insight: 'Fresh', canRetry: false });
    useHome.mockReturnValue({ home: null, isStale: false, error: Object.assign(new Error('temporary'), { httpStatus: 503 }), refetch: homeRetry });
    rerender();
    expect(result.current).toMatchObject({ overviewStatus: OVERVIEW_STATUS.PARTIAL, insight: null, canRetry: true });
    result.current.retryFailedReads();
    expect(homeRetry).toHaveBeenCalledTimes(1);
    expect(coreRetry).not.toHaveBeenCalled();
    useHome.mockReturnValue({ home: { aiInsight: 'Recovered' }, isStale: false, error: null, refetch: homeRetry });
    rerender();
    expect(result.current).toMatchObject({ overviewStatus: OVERVIEW_STATUS.COMPLETE, insight: 'Recovered', canRetry: false });
  });

  it('a known CLIENT permission boundary is UNAVAILABLE, not a health outage', () => {
    useCollabRole.mockReturnValue({ role: 'CLIENT' });
    useAccountHealth.mockReturnValue({ health: null, loading: false, error: null, forbidden: true });
    const view = model();
    expect(view.overviewStatus).toBe(OVERVIEW_STATUS.UNAVAILABLE);
    expect(view.accountState).toBe(ACCOUNT_STATE.SCORING_HIDDEN);
  });

  it('a required 403 for an operating role cannot become LEARNING', () => {
    useAccountHealth.mockReturnValue({ health: null, loading: false, error: null, forbidden: true });
    const view = model();
    expect(view.overviewStatus).toBe(OVERVIEW_STATUS.UNAVAILABLE);
    expect(view.accountState).toBe(ACCOUNT_STATE.UNREADABLE);
  });

  it('campaigns with an unresolved health payload cannot become LEARNING', () => {
    useAccountHealth.mockReturnValue({ health: null, loading: false, error: null, forbidden: false });
    const view = model();
    expect(view.overviewStatus).toBe(OVERVIEW_STATUS.UNAVAILABLE);
    expect(view.accountState).toBe(ACCOUNT_STATE.UNREADABLE);
    expect(view.bands).toBeNull();
  });

  it('loading cannot be classified as a final state', () => {
    useAccountHealth.mockReturnValue({ health: null, loading: true, error: null });
    expect(model()).toMatchObject({ overviewStatus: OVERVIEW_STATUS.LOADING, accountState: null });
  });
});
