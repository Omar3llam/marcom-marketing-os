import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { api, read, report } = vi.hoisted(() => ({ api: { get: vi.fn() }, read: {}, report: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api }));
vi.mock('@/hooks/useConnectorCampaigns.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useConnectorCampaigns: () => {
    const result = actual.useConnectorCampaigns(); read.refetch = result.refetch; return result;
  } };
});
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: vi.fn() }));
vi.mock('@/hooks/useAccountAggregate.js', () => ({ useAccountAggregate: vi.fn() }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'USD' } }) }));
vi.mock('@/hooks/useOnboardingContext.js', () => ({ useOnboardingContext: () => ({ context: null, loading: false, error: null }) }));
vi.mock('@/hooks/useCampaignAnalysis.js', () => ({ useCampaignAnalysis: () => ({ syncing: false, handleMetaSync: vi.fn() }) }));
vi.mock('@/lib/pdfExport.js', () => ({ generateCampaignReport: report, generateTextReport: vi.fn() }));
vi.mock('@/features/campaigns/ConnectorCampaignsPanel.jsx', () => ({ ConnectorCampaignsPanel: vi.fn(() => <div />) }));
import CampaignsView from './CampaignsView.jsx';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useAccountAggregate } from '@/hooks/useAccountAggregate.js';
import { ConnectorCampaignsPanel } from './ConnectorCampaignsPanel.jsx';

const campaigns = ['a', 'b'].map((entityId) => ({ entityId, name: entityId, channel: 'META', adSetCount: 0 }));
const emptyDistribution = { status: 'EMPTY', reason: 'NO_SCORED_SPEND', currency: null,
  totalSpendMinor: null, killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null,
  killPct: null, holdPct: null, scalePct: null };
const verdictRead = (over = {}) => ({ verdicts: [{ id: 'a', verdict: 'KILL' }, { id: 'b', verdict: 'REALLOCATE' }],
  gatedOut: [], memory: {}, loading: false, error: null, refetch: vi.fn(), budgetDistribution: emptyDistribution, ...over });
const header = () => within(screen.getByRole('heading', { name: 'Decision Queue' }).closest('header'));
const pdf = () => header().getByRole('button', { name: 'PDF Report' });
const view = () => render(<CampaignsView />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/app/campaigns?entity=target']}>{children}</MemoryRouter> });
const settle = async (rows = campaigns) => {
  api.get.mockResolvedValue({ data: { campaigns: rows } }); view();
  await waitFor(() => expect(header().queryByText('No campaigns synced yet') ?? header().queryByText(/campaigns? · live/)).toBeInTheDocument());
};
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(() => new Promise(() => {}));
  useConnectorVerdicts.mockReturnValue(verdictRead());
  useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() });
  useAccountAggregate.mockReturnValue({ response: null, loading: false, error: null, refetch: vi.fn() });
});

describe('SC-17B real campaign read → header/export truth', () => {
  it('pending [] renders checking copy rather than successful empty', () => {
    view();
    expect(header().getByText('Checking synced campaigns…')).toBeInTheDocument();
    expect(header().queryByText('No campaigns synced yet')).not.toBeInTheDocument();
  });
  it.each(['network', 'contract'])('%s failure renders unreadable copy, never successful empty', async (kind) => {
    if (kind === 'network') api.get.mockRejectedValue(new Error('network'));
    else api.get.mockResolvedValue({ data: { campaigns: 'invalid' } });
    view();
    expect(await header().findByText('Couldn’t read synced campaigns.')).toBeInTheDocument();
    expect(header().queryByText('No campaigns synced yet')).not.toBeInTheDocument();
    expect(pdf()).toBeDisabled();
    expect(pdf()).toHaveAttribute('title', 'Can’t export while the campaign read is unavailable');
    expect(header().queryByText(/need(s)? action/)).not.toBeInTheDocument();
    const props = ConnectorCampaignsPanel.mock.calls.at(-1)[0];
    expect(props.error).toBeTruthy(); expect(props.deepLinkEntityId).toBe('target');
  });
  it('pending PDF tooltip cannot diagnose a sync or connection configuration', () => {
    view(); expect(pdf()).toBeDisabled();
    expect(pdf().title).toMatch(/checking/i);
    expect(pdf().title).not.toMatch(/sync|connect|Meta/i);
  });
  it('only successful [] establishes the existing empty subtitle and neutral PDF absence', async () => {
    await settle([]);
    expect(header().getByText('No campaigns synced yet')).toBeInTheDocument();
    expect(pdf()).toBeDisabled(); expect(pdf()).toHaveAttribute('title', 'No campaign data to export');
    expect(header().queryByText(/need(s)? action/)).not.toBeInTheDocument();
  });
  it.each([1, 2])('successful %s-row read preserves exact singular/plural count', async (n) => {
    await settle(campaigns.slice(0, n));
    expect(header().getByText(`${n} campaign${n === 1 ? '' : 's'} · live`)).toBeInTheDocument();
  });
  it('present campaigns retain the independent Budget at Risk combined subtitle', async () => {
    useAccountHealth.mockReturnValue({ health: { score: 40, label: 'AT RISK', wastedSpend: { minor: 20000, pct: 20 }, campaigns: [] }, refetch: vi.fn() });
    await settle();
    expect(header().getByText('$200.00 budget at risk · 2 campaigns · live')).toBeInTheDocument();
  });
  it.each(['pending', 'failed'])('%s campaigns retract counts but preserve valid independent KPIs', async (kind) => {
    useAccountHealth.mockReturnValue({ health: { score: 40, label: 'AT RISK', wastedSpend: { minor: 20000, pct: 20 }, campaigns: [] }, refetch: vi.fn() });
    useAccountAggregate.mockReturnValue({ response: { available: true, reason: null, aggregate: {
      currency: 'USD', currencyStatus: 'SINGLE', population: { measurementWindow: 'CUMULATIVE_30D', boundsStatus: 'NOT_REPORTED' },
      spend: { minor: 100000, unavailable: null }, acquisition: { conversions: 10, blendedCpaMinor: 10000, unavailable: null },
    } }, loading: false, error: null, refetch: vi.fn() });
    if (kind === 'failed') api.get.mockRejectedValue(new Error('network'));
    view();
    if (kind === 'failed') await header().findByText('Couldn’t read synced campaigns.');
    expect(header().queryByText(/campaigns? · live|budget at risk|need(s)? action/)).not.toBeInTheDocument();
    expect(screen.getByText('40/100')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });
  it.each(['pending', 'failed'])('%s verdicts suppress action counts and export without changing successful campaign count', async (kind) => {
    useConnectorVerdicts.mockReturnValue(verdictRead({ loading: kind === 'pending', error: kind === 'failed' ? new Error('verdicts') : null }));
    await settle();
    expect(header().queryByText(/need(s)? action/)).not.toBeInTheDocument();
    expect(header().getByText('2 campaigns · live')).toBeInTheDocument();
    expect(pdf()).toBeDisabled();
    expect(pdf().title).toMatch(kind === 'pending' ? /checking/i : /unavailable/i);
  });
  it('successful reads retain positive KILL/REALLOCATE action count and export', async () => {
    await settle();
    expect(header().getByText('2 campaigns need action')).toBeInTheDocument();
    expect(pdf()).toBeEnabled(); expect(pdf()).toHaveAttribute('title', 'Download PDF Report');
    fireEvent.click(pdf()); await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report.mock.calls[0][0].campaigns).toHaveLength(2);
  });
  it('successful zero action count omits the line', async () => {
    useConnectorVerdicts.mockReturnValue(verdictRead({ verdicts: [{ id: 'a', verdict: 'HOLD' }, { id: 'b', verdict: 'WATCH' }] }));
    await settle(); expect(header().queryByText(/need(s)? action/)).not.toBeInTheDocument();
  });
  it('successful campaigns do not repair independent AccountHealth absence', async () => {
    await settle(); expect(header().getByText('2 campaigns · live')).toBeInTheDocument();
    expect(screen.queryByText('40/100')).not.toBeInTheDocument();
  });
  it.each(['empty', 'present'])('retry retracts previous %s claim until fresh success', async (previous) => {
    await settle(previous === 'empty' ? [] : campaigns);
    let resolve;
    api.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    let pending;
    act(() => { pending = read.refetch(); });
    expect(header().getByText('Checking synced campaigns…')).toBeInTheDocument();
    expect(header().queryByText(/No campaigns synced yet|campaigns? · live|need(s)? action/)).not.toBeInTheDocument();
    expect(pdf()).toBeDisabled(); expect(pdf().title).not.toMatch(/sync|connect|Meta/i);
    await act(async () => { resolve({ data: { campaigns } }); await pending; });
    expect(header().getByText('2 campaigns · live')).toBeInTheDocument();
  });
});
