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
vi.mock('@/hooks/useAccountAggregate.js', () => ({ useAccountAggregate: vi.fn() }));
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
import { useAccountAggregate } from '@/hooks/useAccountAggregate.js';

const CONN = [{
  entityId: 'a', name: 'A', channel: 'META',
  spendMinor: 100000, conversions: 10, ctr: 0.02, frequency: 1, roas: 2, currency: 'USD', adSetCount: 0,
}];

// PARITY-01 — the KPI strip reads GET /lumi/account/aggregate now. The rows
// below still mirror CONN exactly (100_000 minor USD over 10 conversions) so
// every assertion in this file keeps asserting the same rendered figures; what
// changed is WHERE the figure comes from, not what it is.
const AGG = ({ currency = 'USD', spendMinor = 100_000, conversions = 10, cpaMinor = 10_000 } = {}) => ({
  response: {
    workspaceId: 'ws', generatedAt: '2026-09-08T00:00:00.000Z', available: true, reason: null,
    aggregate: {
      aggregationLevel: 'CAMPAIGN',
      population: {
        measurementWindow: 'CUMULATIVE_30D', windowStart: null, windowEnd: null,
        boundsStatus: 'NOT_REPORTED', declaredWindow: 'CUMULATIVE_30D', campaignCount: 1,
      },
      currency, currencyStatus: 'SINGLE',
      spend: { minor: spendMinor, unavailable: null },
      acquisition: { conversions, blendedCpaMinor: cpaMinor, unavailable: null },
      verdicts: { KILL: 0, HOLD: 0, SCALE: 0, WATCH: 0, REALLOCATE: 0, REFRESH: 0, unverdicted: 1 },
      spendByVerdict: { KILL: 0, HOLD: 0, SCALE: 0, WATCH: 0, REALLOCATE: 0, REFRESH: 0, unverdicted: spendMinor },
      spendByVerdictUnavailable: null,
    },
  },
  loading: false, error: null, forbidden: false, refetch: vi.fn(),
});

beforeEach(() => {
  useConnectorCampaigns.mockReturnValue({ campaigns: CONN, loading: false, error: null, refetch: vi.fn() });
  useConnectorVerdicts.mockReturnValue({ verdicts: [], gatedOut: [], refetch: vi.fn() });
  useAccountAggregate.mockReturnValue(AGG());
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
    renderView();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();  // 100000 minor / 100
    expect(screen.getByText('$100.00')).toBeInTheDocument();    // CPA: 1000 / 10 conversions
  });

  // The KPI strip formats through lib/currencyFormatter (ar-KW → Arabic-Indic
  // digits), so we assert on the DIGITS that render, not Latin ones. What this
  // pins is the MAGNITUDE: 1_416_000 fils is 1,416 KWD, not 14,160.
  it('a 3-decimal currency renders its true value, never 10x (KWD = 1000 fils)', () => {
    useAccountAggregate.mockReturnValue(AGG({
      currency: 'KWD', spendMinor: 1_416_000, conversions: 8, cpaMinor: 177_000,
    }));
    renderView();
    expect(screen.getByText(/١٬٤١٦/)).toBeInTheDocument();          // 1,416 KWD — true spend
    expect(screen.getByText(/١٧٧/)).toBeInTheDocument();            // CPA: 1416 / 8 conversions
    expect(screen.queryByText(/١٤٬١٦٠/)).not.toBeInTheDocument();   // the /100 answer, 10x over
  });
});

// ── PARITY-01 · a failed read is not an empty account ───────────────────────
describe('CampaignsView — the KPI strip never turns a failed read into a claim', () => {
  beforeEach(() => useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() }));

  it('a FAILED aggregate read says so, and never "No data yet"', () => {
    // The defect: `live = connectorCampaigns.length > 0` made [] — which is what
    // a failed read leaves behind — indistinguishable from a measured empty
    // account, so the strip told the operator they had no data while the panel
    // below it correctly said it could not load.
    useAccountAggregate.mockReturnValue({
      response: null, loading: false, error: new Error('boom'), forbidden: false, refetch: vi.fn(),
    });
    renderView();
    expect(screen.queryByText(/No data yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Couldn’t read this account/i)).toBeInTheDocument();
  });

  it('a MEASURED empty account still says "No data yet" — the one true case', () => {
    useAccountAggregate.mockReturnValue({
      response: {
        workspaceId: 'ws', generatedAt: 'now', available: false,
        reason: 'NO_CANONICAL_MEASUREMENT', aggregate: null,
      },
      loading: false, error: null, forbidden: false, refetch: vi.fn(),
    });
    renderView();
    expect(screen.getByText(/No data yet/i)).toBeInTheDocument();
  });

  it('a MIXED-CURRENCY account gets no total at all — not a sum, not a zero', () => {
    const mixed = AGG();
    mixed.response.aggregate.currency = null;
    mixed.response.aggregate.currencyStatus = 'MIXED';
    mixed.response.aggregate.spend = { minor: null, unavailable: 'MIXED_CURRENCY' };
    mixed.response.aggregate.acquisition = { conversions: 40, blendedCpaMinor: null, unavailable: 'MIXED_CURRENCY' };
    useAccountAggregate.mockReturnValue(mixed);
    renderView();
    expect(screen.getByText(/Mixed currencies/i)).toBeInTheDocument();
    expect(screen.queryByText(/No data yet/i)).not.toBeInTheDocument();
    // and no fabricated figure in any currency
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument();
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
