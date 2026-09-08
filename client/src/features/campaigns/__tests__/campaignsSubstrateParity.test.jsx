// ============================================================
// PARITY-04 · a malformed 200 may not manufacture "Needs Data"
// ------------------------------------------------------------
// THE ASSERTION THAT MATTERS, and the reason this file exists apart from
// CampaignsView.test.jsx: that file stubs ConnectorCampaignsPanel, so the
// grouping BANDS never render there and the consequence cannot be seen.
//
// The defect was not "a hook lacked validation". It was:
//
//     GET /entities/verdicts  →  200, shape changed
//         → Array.isArray(res.data?.verdicts) ? … : []
//             → every campaign unscored
//                 → campaignGrouping → UNSCORED
//                     → "Needs Data", for the whole account
//
// with `error` null and `loading` false the entire way. And `gatedOut` emptied
// by the same default, so the C-07 line explaining WHY a campaign cannot be
// scored disappeared alongside it: the operator was told there was a problem,
// and not what it was, by a request that succeeded.
//
// So these assert the CONSEQUENCE, never `error === true`.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: vi.fn() }));
vi.mock('@/hooks/useAccountAggregate.js', () => ({ useAccountAggregate: vi.fn() }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'USD' } }) }));
vi.mock('@/hooks/useOnboardingContext.js', () => ({ useOnboardingContext: () => ({ context: null, loading: false, error: null }) }));
vi.mock('@/hooks/useCampaignAnalysis.js', () => ({ useCampaignAnalysis: () => ({ syncing: false, handleMetaSync: vi.fn() }) }));
vi.mock('@/hooks/useEntityDrillDown.js', () => ({ useEntityDrillDown: () => ({ byId: {}, load: vi.fn() }) }));
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn(() => Promise.resolve({ data: { reasoning: null, stale: false } })) } }));
// Heavy child; the bands under test live in ConnectorCampaignsPanel, which is REAL here.
vi.mock('@/components/campaign-analysis/PerformanceChart.jsx', () => ({ PerformanceChart: () => <div /> }));

import CampaignsView from '../CampaignsView.jsx';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useAccountAggregate } from '@/hooks/useAccountAggregate.js';

const CONN = [{
  entityId: 'a', name: 'Eid Sales', channel: 'META', adSetCount: 0,
  spendMinor: 100000, conversions: 10, ctr: 0.02, frequency: 1, roas: 2, currency: 'USD',
}];

const verdictsHook = (over = {}) => ({
  verdicts: [], gatedOut: [], memory: {},
  decisionHistoryStatus: null, decisionHistoryKnowledge: null,
  error: null, refetch: vi.fn(), ...over,
});

const renderView = () => render(<CampaignsView />, { wrapper: MemoryRouter });

beforeEach(() => {
  useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() });
  useAccountAggregate.mockReturnValue({ response: null, loading: false, error: null, forbidden: false, refetch: vi.fn() });
  useConnectorCampaigns.mockReturnValue({ campaigns: CONN, loading: false, error: null, refetch: vi.fn() });
  useConnectorVerdicts.mockReturnValue(verdictsHook());
});

describe('PARITY-04 · an unreadable substrate is never rendered as a verdict', () => {
  it('a FAILED verdicts read does not band the account as Needs Data', () => {
    // Campaigns healthy, verdicts empty BECAUSE the read failed. Before this
    // slice the page drew the whole table with every row unscored, and nothing
    // anywhere said the verdict read had not landed.
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      error: new Error('Verdicts response failed contract validation'),
    }));
    renderView();
    expect(screen.queryByText('Needs Data')).not.toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it('a FAILED campaigns read behaves the same way', () => {
    useConnectorCampaigns.mockReturnValue({
      campaigns: [], loading: false,
      error: new Error('Campaigns response failed contract validation'),
      refetch: vi.fn(),
    });
    renderView();
    expect(screen.queryByText('Needs Data')).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('a VALID empty verdict set STILL bands as Needs Data — that one is measured', () => {
    // Without this the guards above would also be satisfied by a page that had
    // stopped rendering bands entirely, and would prove nothing.
    renderView();
    expect(screen.getByText('Needs Data')).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it('a real verdict still bands, and is not swallowed by the new guard', () => {
    useConnectorVerdicts.mockReturnValue(verdictsHook({
      verdicts: [{ id: 'a', name: 'Eid Sales', verdict: 'KILL', confidence: 0.8, rationale: 'why', spendMinor: 100000 }],
    }));
    renderView();
    expect(screen.getByLabelText('Verdict: KILL')).toBeInTheDocument();
  });
});

describe('PARITY-04 · the export cannot publish the false claim', () => {
  it('is refused while the substrate is unreadable', () => {
    // The PDF carries verdicts and gating reasons. Exporting here would hand
    // someone a document asserting every campaign is unscored.
    useConnectorVerdicts.mockReturnValue(verdictsHook({ error: new Error('boom') }));
    renderView();
    expect(screen.getByRole('button', { name: /export|pdf/i })).toBeDisabled();
  });

  it('…and offered when both reads are healthy (self-refutation)', () => {
    renderView();
    expect(screen.getByRole('button', { name: /export|pdf/i })).not.toBeDisabled();
  });
});
