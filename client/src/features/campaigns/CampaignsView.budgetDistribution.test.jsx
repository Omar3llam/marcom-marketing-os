import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import source from './CampaignsView.jsx?raw';
import { formatCurrency } from '@/lib/money';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: () => ({ campaigns: [], loading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: () => ({ health: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useAccountAggregate.js', () => ({ useAccountAggregate: () => ({ response: null, loading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'USD' } }) }));
vi.mock('@/hooks/useOnboardingContext.js', () => ({ useOnboardingContext: () => ({ context: null, loading: false, error: null }) }));
vi.mock('@/hooks/useCampaignAnalysis.js', () => ({ useCampaignAnalysis: () => ({ syncing: false, handleMetaSync: vi.fn() }) }));
vi.mock('@/features/campaigns/ConnectorCampaignsPanel.jsx', () => ({ ConnectorCampaignsPanel: () => <div /> }));
import CampaignsView from './CampaignsView.jsx';

const available = { status: 'AVAILABLE', reason: null, currency: 'EGP', totalSpendMinor: 1000,
  killSpendMinor: 250, holdSpendMinor: 500, scaleSpendMinor: 250,
  killPct: 24.99, holdPct: 50.02, scalePct: 24.99 };
const absent = (status, reason) => ({ status, reason, currency: null, totalSpendMinor: null,
  killSpendMinor: null, holdSpendMinor: null, scaleSpendMinor: null, killPct: null, holdPct: null, scalePct: null });
const response = (budgetDistribution) => ({ verdicts: [{ id: 'a', verdict: 'KILL', spendMinor: 999999 }], gatedOut: [], status: 'OK', budgetDistribution });
const view = () => render(<CampaignsView />, { wrapper: MemoryRouter });
const chart = () => screen.getByText('Scored campaign spend distribution').closest('section');
const noEvidence = () => {
  expect(within(chart()).queryByRole('img')).not.toBeInTheDocument();
  expect(within(chart()).queryByText(/\d+%/)).not.toBeInTheDocument();
  expect(chart().querySelector('[style*="width"]')).toBeNull();
  expect(chart()).not.toHaveTextContent(/EGP|USD|ج\.م|\$|Total scored spend/);
};
beforeEach(() => vi.clearAllMocks());

describe('SC-17A wire → schema → real hook → CampaignsView → real chart', () => {
  it('renders backend shares even when verdict-row spend contradicts them', async () => {
    api.get.mockResolvedValue({ data: response(available) }); view();
    await waitFor(() => expect(within(chart()).getByText('50.02%')).toBeInTheDocument());
    expect(within(chart()).getAllByText('24.99%')).toHaveLength(2);
    expect(chart()).toHaveTextContent('EGP');
    expect(chart().textContent).toContain(formatCurrency(1000, 'EGP'));
    expect(chart().textContent).toContain(formatCurrency(500, 'EGP'));
    expect(chart()).not.toHaveTextContent('USD');
    expect(chart().textContent).not.toContain(formatCurrency(999999, 'EGP'));
  });
  it.each([
    [absent('UNAVAILABLE', 'MIXED_CURRENCY'), /currencies cannot be combined/i],
    [absent('UNAVAILABLE', 'UNKNOWN_CURRENCY'), /denomination cannot be established/i],
    [absent('EMPTY', 'NO_SCORED_SPEND'), /no scored campaign spend/i],
  ])('published absence reaches the chart without fabricated shares: %j', async (budgetDistribution, copy) => {
    api.get.mockResolvedValue({ data: response(budgetDistribution) }); view();
    expect(await screen.findByText(copy)).toBeInTheDocument();
    noEvidence();
  });
  it('pending verdict read renders loading, not successful empty', () => {
    api.get.mockImplementation(() => new Promise(() => {})); view();
    expect(within(chart()).getByRole('status')).toHaveTextContent(/loading scored campaign spend distribution/i);
    noEvidence();
    expect(within(chart()).queryByText(/no scored/i)).not.toBeInTheDocument();
  });
  it.each(['network', 'malformed', 'unknown-status'])('%s failure reaches the chart as an error', async (kind) => {
    if (kind === 'network') api.get.mockRejectedValue(new Error('network'));
    else api.get.mockResolvedValue({ data: response({ ...available, ...(kind === 'malformed' ? { holdPct: 'wrong' } : { status: 'UNKNOWN' }) }) });
    view();
    await waitFor(() => expect(within(chart()).getByRole('alert')).toHaveTextContent(/couldn.t load scored campaign spend distribution/i));
    noEvidence();
    expect(within(chart()).queryByText(/no scored/i)).not.toBeInTheDocument();
  });
  it('ratchets removal of the client monetary chart roll-up', () => {
    expect(source).not.toMatch(/\bconnectorTotals\b|\bchartTotals\b/);
    expect(source).not.toMatch(/v\.spendMinor/);
  });
});
