// ============================================================
// CampaignsView — information hierarchy
// ------------------------------------------------------------
// The page answers "what needs action" before "how much did I spend": the title
// names the queue, the headline count comes from the SAME pure helper the table
// bands with, and the decision queue renders before the account-level chart and
// the legacy feed table rather than after both.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const renderView = () => render(<CampaignsView />, { wrapper: MemoryRouter });

vi.mock('@/hooks/useCampaignFeed.js', () => ({
  useCampaignFeed: () => ({ campaigns: [], loading: false }),
  metricValue: () => null,
}));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: vi.fn() }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'USD' } }) }));
vi.mock('@/hooks/useOnboardingContext.js', () => ({ useOnboardingContext: () => ({ context: null, loading: false, error: null }) }));
vi.mock('@/hooks/useCampaignAnalysis.js', () => ({ useCampaignAnalysis: () => ({ syncing: false, handleMetaSync: vi.fn() }) }));

// Marker stubs — the children's own behaviour is tested elsewhere; here we only
// need to know WHERE each one lands in the document.
vi.mock('@/components/campaign-analysis/PerformanceChart.jsx', () => ({ PerformanceChart: () => <div data-section="chart" /> }));
vi.mock('@/components/campaign-analysis/AnalysisSummary.jsx', () => ({ AnalysisSummary: () => <div data-section="legacy-table" /> }));
vi.mock('@/features/campaigns/ConnectorCampaignsPanel.jsx', () => ({ ConnectorCampaignsPanel: () => <div data-section="queue" /> }));

import CampaignsView from './CampaignsView.jsx';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';

const conn = (entityId, over = {}) => ({
  entityId, name: entityId.toUpperCase(), channel: 'META',
  spendMinor: 100000, conversions: 10, ctr: 0.02, frequency: 1, roas: 2,
  currency: 'USD', adSetCount: 0, ...over,
});
const setCampaigns = (campaigns) =>
  useConnectorCampaigns.mockReturnValue({ campaigns, loading: false, error: null, refetch: vi.fn() });
const setVerdicts = (verdicts) =>
  useConnectorVerdicts.mockReturnValue({ verdicts, gatedOut: [], refetch: vi.fn() });

beforeEach(() => {
  setCampaigns([conn('a')]);
  setVerdicts([]);
  useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() });
});

describe('CampaignsView — the page names what it is', () => {
  it('is titled "Decision Queue", not "Campaign Analysis"', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Decision Queue');
    expect(screen.queryByText('Campaign Analysis')).not.toBeInTheDocument();
  });

  // .decision-title (20px) is SMALLER than .metric-display (24px), so the old
  // heading lost the hierarchy contest to the KPI numbers beneath it.
  it('uses the page-title role class, so the heading outranks the KPI numbers', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('page-title');
  });
});

describe('CampaignsView — the headline count', () => {
  it('leads with how many campaigns need action', () => {
    setCampaigns([conn('a'), conn('b'), conn('c')]);
    setVerdicts([
      { id: 'a', verdict: 'KILL' },
      { id: 'b', verdict: 'REALLOCATE' }, // also the ACTION band
      { id: 'c', verdict: 'SCALE' },      // healthy — not counted
    ]);
    renderView();
    expect(screen.getByText('2 campaigns need action')).toBeInTheDocument();
  });

  it('says "1 campaign needs action" in the singular', () => {
    setCampaigns([conn('a')]);
    setVerdicts([{ id: 'a', verdict: 'KILL' }]);
    renderView();
    expect(screen.getByText('1 campaign needs action')).toBeInTheDocument();
  });

  // Nothing to act on → no line at all. A "0 campaigns need action" banner is
  // noise, and it would compete with the title for the same glance.
  it('says nothing when no campaign is in the action band', () => {
    setCampaigns([conn('a')]);
    setVerdicts([{ id: 'a', verdict: 'HOLD' }]);
    renderView();
    expect(screen.queryByText(/need(s)? action/)).not.toBeInTheDocument();
  });

  // WATCH/REFRESH are the Watching band — real, but not "act now".
  it('counts only the action band, not everything with a verdict', () => {
    setCampaigns([conn('a'), conn('b')]);
    setVerdicts([{ id: 'a', verdict: 'WATCH' }, { id: 'b', verdict: 'REFRESH' }]);
    renderView();
    expect(screen.queryByText(/need(s)? action/)).not.toBeInTheDocument();
  });
});

describe('CampaignsView — budget at risk in the subtitle', () => {
  it('quotes the engine figure in the same formatter as the KPI card', () => {
    useAccountHealth.mockReturnValue({
      health: { score: 40, label: 'AT RISK', wastedSpend: { minor: 20000, pct: 20 }, campaigns: [] },
      refetch: vi.fn(),
    });
    renderView();
    // $200.00 appears in the subtitle AND on the card — identical formatting, so
    // the header and the card can never quote different numbers.
    expect(screen.getByText(/\$200\.00 budget at risk · 1 campaign · live/)).toBeInTheDocument();
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0);
  });

  it('drops the clause entirely when nothing is at risk — never "$0.00 at risk"', () => {
    useAccountHealth.mockReturnValue({
      health: { score: 90, label: 'HEALTHY', wastedSpend: { minor: 0, pct: 0 }, campaigns: [] },
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.queryByText(/budget at risk/)).not.toBeInTheDocument();
    expect(screen.getByText('1 campaign · live')).toBeInTheDocument();
  });

  it('keeps the honest empty state when nothing has synced', () => {
    setCampaigns([]);
    renderView();
    expect(screen.getByText('No campaigns synced yet')).toBeInTheDocument();
  });
});

describe('CampaignsView — KPI order', () => {
  it('leads with Budget at Risk and ends with Blended CPA', () => {
    renderView();
    const labels = [...document.querySelectorAll('.section-label')]
      .map((el) => el.textContent.trim())
      .filter((t) => ['Budget at Risk', 'Account Health', 'Total Spend', 'Blended CPA'].includes(t));
    expect(labels).toEqual(['Budget at Risk', 'Account Health', 'Total Spend', 'Blended CPA']);
  });

  it('no longer calls it "Wasted Spend"', () => {
    renderView();
    expect(screen.queryByText('Wasted Spend')).not.toBeInTheDocument();
  });
});

describe('CampaignsView — render order', () => {
  const orderOf = (container) =>
    [...container.querySelectorAll('[data-section]')].map((el) => el.dataset.section);

  it('puts the decision queue ahead of the chart and the legacy table', () => {
    const { container } = renderView();
    expect(orderOf(container)).toEqual(['queue', 'chart', 'legacy-table']);
  });
});
