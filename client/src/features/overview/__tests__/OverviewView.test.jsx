// ============================================================
// OverviewView — the agentic shell is decoupled from the legacy feed
// ------------------------------------------------------------
// The bug: the Overview gated <AgenticShellView /> (the two-band agenda that
// carries live connector VERDICTs) behind `hasData`, which reads ONLY the legacy
// CampaignState feed (useIntelligence → /api/lumi/feed). A workspace that had
// synced Meta via connectors — real Campaign entities + MetricSnapshot + PROPOSED
// verdicts — still showed "No campaign data yet" and the agenda was never mounted.
//
// These tests pin the fix: the shell renders on EITHER substrate, the empty state
// shows only when BOTH are empty, and (post-H1) the KPI stat block is
// CONNECTOR-FIRST — it renders real connector figures on a connector-only
// account, null→"—" for any absent metric (never fabricated).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => ({ currentUser: { displayName: 'Omar A' } }) }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { name: 'Acme', currency: 'USD' } }) }));
vi.mock('@/context/IntelligenceContext.jsx', () => ({ useIntelligence: vi.fn() }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useConnections.js', () => ({ useConnections: vi.fn() }));
vi.mock('@/hooks/useAccuracy.js', () => ({ useAccuracy: () => ({ surface: null }) }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: vi.fn() }));
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: vi.fn() }));
vi.mock('@/hooks/useCollabRole.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useCollabRole: vi.fn() };
});

// Child components mocked to markers/null so we test OverviewView's gating only.
vi.mock('../AgenticShellView.jsx', () => ({ default: () => <div data-testid="agentic-shell">shell</div> }));
vi.mock('../components/FirstRunBanner.jsx', () => ({ default: () => <div data-testid="first-run">first-run</div> }));
vi.mock('../components/RevenueOnboardingBanner.jsx', () => ({ default: () => <div data-testid="revenue-onboarding">revenue-onboarding</div> }));
vi.mock('../components/ConnectionHealthStrip.jsx', () => ({ default: () => null }));
vi.mock('../components/PacingWidget.jsx', () => ({ default: () => <div data-testid="pacing" /> }));
vi.mock('../components/CopilotPanel.jsx', () => ({ default: () => null }));
vi.mock('@/features/intelligence/proof/ProofView.jsx', () => ({ ProofSummary: () => null }));
vi.mock('@/components/ui/StatCard.jsx', () => ({ default: ({ label }) => <div data-testid="stat-card">{label}</div> }));

import OverviewView from '../OverviewView.jsx';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useAccountHealth } from '@/hooks/useAccountHealth.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';

const CONNECTOR_ROW = { entityId: 'c1', name: 'Eid Sale', channel: 'META', spendMinor: 50000, ctr: 0.0185 };
const LEGACY_ROW = { campaign_id: 'x', alerts: [] };

const renderView = () => render(<MemoryRouter><OverviewView /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear(); // firstActivation flag must not bleed across tests
  useCollabRole.mockReturnValue({ role: WORKSPACE_ROLE.STRATEGIST });
  // defaults; each test overrides the substrate under test
  useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
  useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
  // Default: no channel has ever synced → the revenue-onboarding banner stays hidden
  // and every pre-existing test is unaffected. Revenue-banner tests override this.
  useConnections.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
  // Default: nothing scored → the decision feed renders its honest empty line.
  useAccountHealth.mockReturnValue({ health: null, loading: false, error: null, refetch: vi.fn() });
  useConnectorVerdicts.mockReturnValue({ verdicts: [], gatedOut: [], loading: false, error: null, refetch: vi.fn() });
});

describe('OverviewView — agentic shell is decoupled from the legacy CampaignState feed', () => {
  it('renders the agenda AND connector-first KPI cards when only connector data exists', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false }); // legacy feed empty
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByTestId('agentic-shell')).toBeInTheDocument();
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
    // H1: the KPI block is now connector-first — it renders on a connector-only
    // account (real connector figures / "—"), no longer gated on the legacy feed.
    expect(screen.getAllByTestId('stat-card').length).toBe(4);
  });

  it('shows the empty state (and no agenda) only when BOTH substrates are empty', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByText(/No campaign data yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('agentic-shell')).not.toBeInTheDocument();
  });

  it('renders the agenda AND the legacy stat block when the legacy feed has data (unchanged behavior)', () => {
    useIntelligence.mockReturnValue({ campaigns: [LEGACY_ROW], summary: { spend: 0, health: 0 }, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByTestId('agentic-shell')).toBeInTheDocument();
    expect(screen.getAllByTestId('stat-card').length).toBe(4);
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
  });

  it('shows neither the empty state nor the agenda while data is still loading', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: true });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: true, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('agentic-shell')).not.toBeInTheDocument();
  });
});

// The page led with a greeting and buried the decisions in a 3-column panel row.
// It now leads with the decisions themselves: AlertsPanel and QuickActionsPanel
// are gone (the first duplicated the agenda's job, the second was navigation),
// and the two revenue-data stories survive as their own notices.
describe('OverviewView — the decision feed replaces the panel row', () => {
  const withConnector = () => useConnectorCampaigns.mockReturnValue({
    campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn(),
  });

  it('leads with the decisions, keeping the greeting as a subtitle', () => {
    withConnector();
    renderView();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Today's Decisions");
    expect(screen.getByText(/Omar\. Here's what needs a call\./)).toBeInTheDocument();
  });

  it('no longer renders the Quick Actions shortcuts', () => {
    withConnector();
    renderView();
    expect(screen.queryByText('Quick Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate Content')).not.toBeInTheDocument();
  });

  it('keeps the agenda — the feed sits alongside it, never replaces it', () => {
    withConnector();
    renderView();
    expect(screen.getByTestId('agentic-shell')).toBeInTheDocument();
  });

  it('renders a decision card per actionable campaign, most urgent first', () => {
    withConnector();
    useAccountHealth.mockReturnValue({ health: { campaigns: [
      { entityId: 'c1', name: 'Eid Sale', verdict: 'KILL', impactScore: 6 },
      { entityId: 'c2', name: 'Retarget', verdict: 'WATCH', impactScore: 9 },
      { entityId: 'c3', name: 'Steady', verdict: 'HOLD', impactScore: 9 },
    ] }, loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByText('2 decisions')).toBeInTheDocument();
    expect(screen.getByText('Retarget')).toBeInTheDocument();
    expect(screen.getByText('Eid Sale')).toBeInTheDocument();
    expect(screen.queryByText('Steady')).not.toBeInTheDocument();
  });

  it('says the feed is clear rather than hiding it', () => {
    withConnector();
    renderView();
    expect(screen.getByText('No critical campaigns right now.')).toBeInTheDocument();
  });

  // These two are NOT decisions — the campaign is not performing badly, its
  // revenue is unmeasurable — so they must not be folded into the feed.
  it('surfaces the two revenue stories separately from the decisions', () => {
    withConnector();
    useAccountHealth.mockReturnValue({ health: { campaigns: [
      { entityId: 'g1', name: 'Never Uploaded', verdict: 'HOLD', impactScore: 3, needsRevenue: true },
      { entityId: 's1', name: 'Went Stale', verdict: 'HOLD', impactScore: 3, revenueStale: true },
    ] }, loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByText('Revenue data needed')).toBeInTheDocument();
    expect(screen.getByText('Revenue data outdated')).toBeInTheDocument();
    expect(screen.getByText('No critical campaigns right now.')).toBeInTheDocument();
  });

  it('renders neither notice when every campaign has fresh revenue', () => {
    withConnector();
    renderView();
    expect(screen.queryByText('Revenue data needed')).not.toBeInTheDocument();
    expect(screen.queryByText('Revenue data outdated')).not.toBeInTheDocument();
  });
});

describe('OverviewView — first-run activation banner (wires the onboarding flag)', () => {
  it('firstActivation flag + no data → banner shows, and REPLACES the generic empty state', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByTestId('first-run')).toBeInTheDocument();
    // one call-to-action, not two: the generic empty-state hero is suppressed
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
  });

  it('no flag (returning user) + no data → generic empty state, never the banner', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
    expect(screen.getByText(/No campaign data yet/i)).toBeInTheDocument();
  });

  it('flag set but data exists → banner hidden AND the flag is retired (never resurfaces)', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('marcom:firstActivation')).toBeNull();
  });

  it('flag set but still loading → banner not shown yet (waits for the data verdict)', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: true });
    useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: true, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.queryByTestId('first-run')).not.toBeInTheDocument();
  });
});

describe('OverviewView — post-first-sync revenue onboarding banner', () => {
  const SYNCED = {
    data: { connections: [{ platform: 'META', lastSyncedAt: '2026-07-16T00:00:00Z' }] },
    loading: false, error: null, refetch: vi.fn(),
  };
  const NEVER_SYNCED = {
    data: { connections: [{ platform: 'META', lastSyncedAt: null }] },
    loading: false, error: null, refetch: vi.fn(),
  };
  const withCampaigns = (rows) => ({ campaigns: rows, loading: false, error: null, refetch: vi.fn() });

  it('synced + campaigns scored + no revenue + STRATEGIST → banner shows', () => {
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    renderView();
    expect(screen.getByTestId('revenue-onboarding')).toBeInTheDocument();
  });

  it('no channel has ever synced → banner hidden (nothing to capture revenue against)', () => {
    useConnections.mockReturnValue(NEVER_SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  it('revenue data already present → banner auto-hidden', () => {
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([{ ...CONNECTOR_ROW, revenueMinor: 250000 }]));
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  it('dismissed this session (sessionStorage) → banner hidden', () => {
    sessionStorage.setItem('lumi:revenue-prompt-dismissed', '1');
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  it('CLIENT role → banner hidden (only a strategist can upload revenue)', () => {
    useCollabRole.mockReturnValue({ role: WORKSPACE_ROLE.CLIENT });
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([CONNECTOR_ROW]));
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });

  it('pre-sync first-run state (no campaigns yet) → revenue banner defers', () => {
    sessionStorage.setItem('marcom:firstActivation', '1');
    useConnections.mockReturnValue(SYNCED);
    useConnectorCampaigns.mockReturnValue(withCampaigns([])); // no campaigns → FirstRunBanner territory
    renderView();
    expect(screen.queryByTestId('revenue-onboarding')).not.toBeInTheDocument();
  });
});
