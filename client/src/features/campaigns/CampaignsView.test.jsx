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

// Stub the heavy children — the KPI cards under test live in MetricsPanel (real).
vi.mock('@/components/campaign-analysis/PerformanceChart.jsx', () => ({ PerformanceChart: () => <div /> }));
vi.mock('@/components/campaign-analysis/AnalysisSummary.jsx', () => ({ AnalysisSummary: () => <div /> }));
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
    render(<CampaignsView />);

    expect(screen.getByText('70/100')).toBeInTheDocument();
    expect(screen.getByText('GOOD')).toBeInTheDocument();
    // 20000 minor USD → $200.00 (fromMinor), scale-consistent with Total Spend.
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    expect(screen.getByText('20% of total')).toBeInTheDocument();
  });

  it('null health → honest "—" for both cards, never a fabricated 0', () => {
    useAccountHealth.mockReturnValue({ health: null, refetch: vi.fn() });
    render(<CampaignsView />);

    expect(screen.queryByText('70/100')).not.toBeInTheDocument();
    expect(screen.queryByText(/% of total/)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
