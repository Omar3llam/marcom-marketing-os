import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GrowthStrategyBoard from './InsightsView.jsx';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get: apiGet } }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'BUYER', loading: false, status: 'PRESENT' }),
  WORKSPACE_ROLE: { BUYER: 'BUYER', STRATEGIST: 'STRATEGIST', CLIENT: 'CLIENT' },
}));
vi.mock('@/hooks/useEconomics.js', () => ({
  useEconomics: () => ({ data: null, loading: false, error: null }),
  useSaveEconomics: () => ({ save: vi.fn(), saving: false }),
}));
vi.mock('@/hooks/useGoals.js', () => ({
  useGoals: () => ({ goals: [], isLoading: false, error: null }),
}));
vi.mock('@/hooks/usePlans.js', () => ({
  usePlans: () => ({ plans: [], isLoading: false, error: null }),
}));
vi.mock('@/hooks/useApprovals.js', () => ({ useApprovals: vi.fn() }));

const CAMPAIGNS = '/api/lumi/entities/campaigns';
const VERDICTS = '/api/lumi/entities/verdicts';
const FATIGUE = '/api/lumi/entities/fatigue';
const tokens = ['KILL', 'REFRESH', 'REALLOCATE', 'WATCH', 'HOLD', 'SCALE'];
const campaignRows = tokens.map((_, i) => ({ entityId: `c${i}`, name: `Campaign ${i}`, channel: 'meta', adSetCount: 0 }));
const verdictPayload = (over = {}) => ({
  verdicts: tokens.map((verdict, i) => ({ id: `c${i}`, verdict })),
  gatedOut: [],
  budgetDistribution: { status: 'EMPTY', reason: 'NO_SCORED_SPEND', currency: null,
    totalSpendMinor: null, killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null,
    killPct: null, holdPct: null, scalePct: null },
  ...over,
});
const fatigueRow = { entityId: 'c0', name: 'Forecast campaign', channel: 'meta',
  status: 'SATURATED', currentFrequency: 3.6, velocity: null, daysUntilSaturation: 0 };
const httpError = (status) => Object.assign(new Error('read refused'), { httpStatus: status });
const renderBoard = () => render(<MemoryRouter><GrowthStrategyBoard /></MemoryRouter>);
const tile = () => screen.getByText('Active Campaigns').closest('article');
const assertNoFalseSummary = () => {
  const region = within(tile());
  expect(region.queryByText('0', { exact: true })).not.toBeInTheDocument();
  expect(region.queryByText(/No connected campaigns yet|Awaiting verdicts|Scaling|Killing/)).not.toBeInTheDocument();
};
let responses;
beforeEach(() => {
  vi.clearAllMocks();
  responses = { [CAMPAIGNS]: { campaigns: campaignRows }, [VERDICTS]: verdictPayload(), [FATIGUE]: { forecast: [] } };
  apiGet.mockImplementation((path) => {
    const response = responses[path];
    if (response instanceof Error) return Promise.reject(response);
    if (typeof response === 'function') return response();
    if (!response) throw new Error(`Unexpected read: ${path}`);
    return Promise.resolve({ data: response });
  });
});

describe('P7-02A — real Growth Strategy reads reach the surface', () => {
  it.each([CAMPAIGNS, VERDICTS])('%s rejection withholds the entire count and breakdown', async (source) => {
    responses[source] = httpError(500);
    renderBoard();
    await waitFor(() => expect(within(tile()).getByText(/couldn.t read campaign strategy data/i)).toBeInTheDocument());
    assertNoFalseSummary();
    expect(within(tile()).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('No goals set yet.')).toBeInTheDocument();
  });

  it.each([new Error('Network Error'), httpError(408), httpError(429), httpError(503)])(
    'offers recovery for transient campaign read %j', async (error) => {
      responses[CAMPAIGNS] = error;
      renderBoard();
      await waitFor(() => expect(within(tile()).getByRole('button', { name: 'Try again' })).toBeInTheDocument());
    });

  it.each([httpError(403), httpError(409), new Error('Campaigns response failed contract validation'),
    Object.assign(new Error('role unresolved'), { context: { roleReason: 'ROLE_UNKNOWN' } })])(
    'keeps permanent/contract failure visible without retry %j', async (error) => {
      responses[CAMPAIGNS] = error;
      renderBoard();
      await waitFor(() => expect(within(tile()).getByText(/couldn.t read campaign strategy data/i)).toBeInTheDocument());
      assertNoFalseSummary();
      expect(within(tile()).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

  it('does not retry a transient source while the other required source is permanently refused', async () => {
    responses[CAMPAIGNS] = httpError(500);
    responses[VERDICTS] = httpError(403);
    renderBoard();
    await waitFor(() => expect(within(tile()).getByText(/couldn.t read campaign strategy data/i)).toBeInTheDocument());
    expect(within(tile()).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it.each([CAMPAIGNS, VERDICTS])('preserves connector contract-validation failure for %s', async (source) => {
    responses[source] = {};
    renderBoard();
    await waitFor(() => expect(within(tile()).getByText(/couldn.t read campaign strategy data/i)).toBeInTheDocument());
    assertNoFalseSummary();
    expect(within(tile()).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('keeps successful zero distinct from unreadable', async () => {
    responses[CAMPAIGNS] = { campaigns: [] };
    responses[VERDICTS] = verdictPayload({ verdicts: [] });
    renderBoard();
    await waitFor(() => expect(within(tile()).getByText('No connected campaigns yet')).toBeInTheDocument());
    expect(within(tile()).getByText('0', { exact: true })).toBeInTheDocument();
  });

  it('keeps successful unscored population awaiting verdicts', async () => {
    responses[VERDICTS] = verdictPayload({ verdicts: [] });
    renderBoard();
    await waitFor(() => expect(within(tile()).getByText('Awaiting verdicts')).toBeInTheDocument());
    expect(within(tile()).getByText('6', { exact: true })).toBeInTheDocument();
  });

  it('keeps the six-verdict breakdown and gated reason groups', async () => {
    responses[VERDICTS] = verdictPayload({ gatedOut: [{ id: 'g1', reason: 'NO_MEASURABLE_DELIVERY' }] });
    renderBoard();
    await waitFor(() => expect(within(tile()).getByText(/1 Scaling/)).toBeInTheDocument());
    for (const label of ['Killing', 'Refreshing', 'Reallocating', 'Watching', 'Holding', 'Scaling']) {
      expect(tile().textContent).toContain(`1 ${label}`);
    }
    expect(tile().textContent).toMatch(/with no measurable delivery/);
  });

  it('retry refreshes BOTH sources, clears error and withholds data until both finish', async () => {
    responses[VERDICTS] = httpError(500);
    renderBoard();
    const retry = await within(tile()).findByRole('button', { name: 'Try again' });
    let resolveCampaigns, resolveVerdicts;
    responses[CAMPAIGNS] = () => new Promise(resolve => { resolveCampaigns = resolve; });
    responses[VERDICTS] = () => new Promise(resolve => { resolveVerdicts = resolve; });
    fireEvent.click(retry);
    expect(within(tile()).getByText('Loading…')).toBeInTheDocument();
    expect(within(tile()).queryByRole('alert')).not.toBeInTheDocument();
    assertNoFalseSummary();
    await act(async () => { resolveCampaigns({ data: { campaigns: campaignRows } }); });
    expect(within(tile()).getByText('Loading…')).toBeInTheDocument();
    await act(async () => { resolveVerdicts({ data: verdictPayload() }); });
    expect(within(tile()).getByText(/1 Scaling/)).toBeInTheDocument();
    expect(apiGet.mock.calls.filter(([path]) => path === CAMPAIGNS)).toHaveLength(2);
    expect(apiGet.mock.calls.filter(([path]) => path === VERDICTS)).toHaveLength(2);
  });
});

describe('P7-02A — real fatigue rejection reaches the surface', () => {
  it.each([new Error('Network Error'), httpError(500)])('shows failure and recovery instead of disappearing: %j', async (error) => {
    responses[FATIGUE] = error;
    renderBoard();
    await waitFor(() => expect(screen.getByText(/couldn.t read fatigue forecast/i)).toBeInTheDocument());
    const section = screen.getByText('Fatigue Forecast').closest('section');
    expect(within(section).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await waitFor(() => expect(within(tile()).getByText('6', { exact: true })).toBeInTheDocument());
  });

  it.each([httpError(403), httpError(409), new Error('Fatigue response failed contract validation')])(
    'shows a non-retryable failure without a CTA: %j', async (error) => {
      responses[FATIGUE] = error;
      renderBoard();
      await waitFor(() => expect(screen.getByText(/couldn.t read fatigue forecast/i)).toBeInTheDocument());
      const section = screen.getByText('Fatigue Forecast').closest('section');
      expect(within(section).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

  it('keeps a successful empty forecast hidden', async () => {
    renderBoard();
    await waitFor(() => expect(within(tile()).getByText('6', { exact: true })).toBeInTheDocument());
    expect(screen.queryByText('Fatigue Forecast')).not.toBeInTheDocument();
  });

  it('retry clears the old failure, loads and renders unchanged rows', async () => {
    responses[FATIGUE] = httpError(500);
    renderBoard();
    await screen.findByText(/couldn.t read fatigue forecast/i);
    const section = screen.getByText('Fatigue Forecast').closest('section');
    let resolveRead;
    responses[FATIGUE] = () => new Promise(resolve => { resolveRead = resolve; });
    fireEvent.click(within(section).getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText(/couldn.t read fatigue forecast/i)).not.toBeInTheDocument();
    expect(screen.getByText('Fatigue Forecast').closest('section').textContent).toContain('Loading…');
    await act(async () => { resolveRead({ data: { forecast: [fatigueRow], frequencyCeiling: 4 } }); });
    expect(screen.getByRole('link', { name: /Forecast campaign/ })).toBeInTheDocument();
    expect(screen.getByText('saturated now')).toBeInTheDocument();
    expect(screen.getByText(/Saturation threshold: frequency ≥ 4/)).toBeInTheDocument();
  });
});
