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
// shows only when BOTH are empty, and the legacy stat block stays bound to the
// legacy feed (no fabricated figures from connector rows).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => ({ currentUser: { displayName: 'Omar A' } }) }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { name: 'Acme', currency: 'USD' } }) }));
vi.mock('@/context/IntelligenceContext.jsx', () => ({ useIntelligence: vi.fn() }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: vi.fn() }));
vi.mock('@/hooks/useAccuracy.js', () => ({ useAccuracy: () => ({ surface: null }) }));
vi.mock('@/hooks/useCollabRole.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useCollabRole: vi.fn() };
});

// Child components mocked to markers/null so we test OverviewView's gating only.
vi.mock('../AgenticShellView.jsx', () => ({ default: () => <div data-testid="agentic-shell">shell</div> }));
vi.mock('../components/ConnectionHealthStrip.jsx', () => ({ default: () => null }));
vi.mock('../components/PacingWidget.jsx', () => ({ default: () => <div data-testid="pacing" /> }));
vi.mock('../components/CopilotTeaser.jsx', () => ({ default: () => null }));
vi.mock('@/features/intelligence/proof/ProofView.jsx', () => ({ ProofSummary: () => null }));
vi.mock('@/components/ui/StatCard.jsx', () => ({ default: ({ label }) => <div data-testid="stat-card">{label}</div> }));

import OverviewView from '../OverviewView.jsx';
import { useIntelligence } from '@/context/IntelligenceContext.jsx';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';

const CONNECTOR_ROW = { entityId: 'c1', name: 'Eid Sale', channel: 'META', spendMinor: 50000, ctr: 0.0185 };
const LEGACY_ROW = { campaign_id: 'x', alerts: [] };

const renderView = () => render(<MemoryRouter><OverviewView /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useCollabRole.mockReturnValue({ role: WORKSPACE_ROLE.STRATEGIST });
  // defaults; each test overrides the substrate under test
  useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false });
  useConnectorCampaigns.mockReturnValue({ campaigns: [], loading: false, error: null, refetch: vi.fn() });
});

describe('OverviewView — agentic shell is decoupled from the legacy CampaignState feed', () => {
  it('renders the agenda (and NOT the empty state) when only connector data exists', () => {
    useIntelligence.mockReturnValue({ campaigns: [], summary: null, loading: false }); // legacy feed empty
    useConnectorCampaigns.mockReturnValue({ campaigns: [CONNECTOR_ROW], loading: false, error: null, refetch: vi.fn() });
    renderView();

    expect(screen.getByTestId('agentic-shell')).toBeInTheDocument();
    expect(screen.queryByText(/No campaign data yet/i)).not.toBeInTheDocument();
    // Legacy stat block stays bound to the (empty) legacy feed — no fabricated figures.
    expect(screen.queryByTestId('stat-card')).not.toBeInTheDocument();
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
