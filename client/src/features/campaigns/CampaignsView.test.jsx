// ============================================================
// CampaignsView — KPI strip is backed by the analysis engine
// ------------------------------------------------------------
// Proves the wiring that replaced the dead CSV-analysis pipeline: Account Health
// and Wasted Spend now read from useAccountHealth (the deterministic engine), and
// the minor→major conversion (fromMinor) keeps Wasted on the same scale as the
// Total Spend card. Null health → honest "—", never a fabricated 0.
// The heavy chart/table children are stubbed; MetricsPanel renders for real.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// CampaignsView reads ?entity= via useSearchParams → needs a Router context.
const renderView = () => render(<CampaignsView />, { wrapper: MemoryRouter });

vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: vi.fn() }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'USD' } }) }));
vi.mock('@/hooks/useOnboardingContext.js', () => ({ useOnboardingContext: () => ({ context: null, loading: false, error: null }) }));
vi.mock('@/hooks/useCampaignAnalysis.js', () => ({ useCampaignAnalysis: () => ({ syncing: false, handleMetaSync: vi.fn() }) }));

// Stub the heavy children — the KPI cards under test live in MetricsPanel (real).
vi.mock('@/components/campaign-analysis/PerformanceChart.jsx', () => ({ PerformanceChart: () => <div /> }));
vi.mock('@/features/campaigns/ConnectorCampaignsPanel.jsx', () => ({ ConnectorCampaignsPanel: () => <div /> }));

import CampaignsView from './CampaignsView.jsx';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';

const CONN = [{
  entityId: 'a', name: 'A', channel: 'META',
  spendMinor: 100000, conversions: 10, ctr: 0.02, frequency: 1, roas: 2, currency: 'USD', adSetCount: 0,
}];

beforeEach(() => {
  useConnectorCampaigns.mockReturnValue({ campaigns: CONN, loading: false, error: null, refetch: vi.fn() });
  useConnectorVerdicts.mockReturnValue({ verdicts: [], gatedOut: [], refetch: vi.fn() });
});

describe('CampaignsView — Account Health + Wasted Spend from the engine', () => {
  it('renders the engine health score + label and the wasted spend (minor→major)', () => {
    useAccountHealth.mockReturnValue({
      health: { score: 70, label: 'GOOD', wastedSpend: { minor: 20000, pct: 20 }, campaigns: [] },
      refetch: vi.fn(),
    });
    renderView();

    expect(screen.getByText('70/100')).toBeInTheDocument();
    expect(screen.getByText('GOOD')).toBeInTheDocument();
    // 20000 minor USD → $200.00 (fromMinor), scale-consistent with Total Spend.
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    expect(screen.getByText('20% of total')).toBeInTheDocument();
  });

  it('null health → honest "—" for both cards, never a fabricated 0', () => {
    useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByText('70/100')).not.toBeInTheDocument();
    expect(screen.queryByText(/% of total/)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

// MainLayout's <main> (overflow-y-auto) is the ONE vertical scroll owner. The
// view root nesting its own h-full + overflow-y-auto produced a scroller inside
// a scroller: double scrollbars, wheel trapped in the inner one. Pinned here so
// a styling pass can't quietly reintroduce it.
describe('CampaignsView — single scroll owner', () => {
  it('the view creates no vertical scroll container of its own', () => {
    useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() });
    const { container } = renderView();
    expect(container.querySelector('.overflow-y-auto')).toBeNull();
  });
});

describe('CampaignsView — relative-ranking note', () => {
  beforeEach(() => {
    useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() });
  });

  it('shows the plain-language no-revenue note + sales-data CTA when a verdict was ranked relative', () => {
    useConnectorVerdicts.mockReturnValue({
      verdicts: [{ id: 'a', verdict: 'KILL', roas: null, revenueExpected: false, relativeRank: 'BOTTOM' }],
      gatedOut: [], refetch: vi.fn(),
    });
    renderView();

    expect(screen.getByText(/recommendations are based on CTR, Frequency and Spend only/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /connect sales data to unlock profit-based recommendations/i });
    expect(cta).toHaveAttribute('href', '/app/settings/revenue');
  });

  it('says nothing when no verdict carries a relative rank', () => {
    useConnectorVerdicts.mockReturnValue({
      verdicts: [{ id: 'a', verdict: 'HOLD', roas: null, revenueExpected: false, relativeRank: null }],
      gatedOut: [], refetch: vi.fn(),
    });
    renderView();

    expect(screen.queryByText(/recommendations are based on CTR, Frequency and Spend only/i)).not.toBeInTheDocument();
  });
});

// Total Spend and Blended CPA summed minor units then divided by a hardcoded 100
// — the same exponent bug fixed in the prompt builders. A Gulf dinar is 1000
// fils, so both cards overstated a KWD account 10x.
describe('CampaignsView — KPI strip uses the currency exponent, never /100', () => {
  beforeEach(() => useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() }));

  it('a 2-decimal currency is unaffected (no regression)', () => {
    useConnectorCampaigns.mockReturnValue({ campaigns: CONN, loading: false, error: null, refetch: vi.fn() });
    renderView();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();  // 100000 minor / 100
    expect(screen.getByText('$100.00')).toBeInTheDocument();    // CPA: 1000 / 10 conversions
  });

  // The KPI strip formats through lib/currencyFormatter (ar-KW → Arabic-Indic
  // digits), so we assert on the DIGITS that render, not Latin ones. What this
  // pins is the MAGNITUDE: 1_416_000 fils is 1,416 KWD, not 14,160.
  it('a 3-decimal currency renders its true value, never 10x (KWD = 1000 fils)', () => {
    useConnectorCampaigns.mockReturnValue({
      campaigns: [{ ...CONN[0], spendMinor: 1_416_000, conversions: 8, currency: 'KWD' }],
      loading: false, error: null, refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByText(/١٬٤١٦/)).toBeInTheDocument();          // 1,416 KWD — true spend
    expect(screen.getByText(/١٧٧/)).toBeInTheDocument();            // CPA: 1416 / 8 conversions
    expect(screen.queryByText(/١٤٬١٦٠/)).not.toBeInTheDocument();   // the /100 answer, 10x over
  });
});

// ── C-07 · test 8 — the gated banner speaks per reason ──────────────────────
describe('CampaignsView — gated campaigns name their own reason', () => {
  it('renders one line per reason, and no single "need revenue data" count', () => {
    // Before C-07 this banner read "3 connected campaigns need revenue data
    // before they can be scored" for exactly this population — true for one of
    // the three, and an instruction that would waste the operator's time on the
    // other two, whose fix is a sync.
    useConnectorVerdicts.mockReturnValue({
      verdicts: [],
      gatedOut: [
        { id: 'd', name: 'Dataless', reason: 'NO_MEASURABLE_DELIVERY' },
        { id: 'n', name: 'Never', reason: 'NO_CANONICAL_WINDOW' },
        { id: 's', name: 'Stale', reason: 'CANONICAL_EVIDENCE_STALE', measurementAgeDays: 42, maxAgeDays: 3 },
      ],
      refetch: vi.fn(),
    });
    renderView();

    expect(screen.getByText(/with no measurable delivery/)).toBeInTheDocument();
    expect(screen.getByText(/never measured over the verdict window/)).toBeInTheDocument();
    expect(screen.getByText(/measured too long ago to score today/)).toBeInTheDocument();
    expect(screen.queryByText(/3 connected campaigns need revenue data/)).not.toBeInTheDocument();
  });

  it('says nothing about revenue for the two gates a sync fixes', () => {
    useConnectorVerdicts.mockReturnValue({
      verdicts: [],
      gatedOut: [
        { id: 'n', name: 'Never', reason: 'NO_CANONICAL_WINDOW' },
        { id: 's', name: 'Stale', reason: 'CANONICAL_EVIDENCE_STALE', measurementAgeDays: 9, maxAgeDays: 3 },
      ],
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.queryByText(/need revenue data/)).not.toBeInTheDocument();
  });
});
