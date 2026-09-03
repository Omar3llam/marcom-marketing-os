// ============================================================
// GrowthStrategyBoard — Active Campaigns tile is connector-sourced,
// Bets + Memory stay on the legacy feed
// ------------------------------------------------------------
// The repoint must be surgical: the Active Campaigns tile (count + verdict
// breakdown + "need revenue data") now reads useGrowthStrategySummary (connector
// substrate), while Strategic Bets and the Memory Layer keep reading the legacy
// CampaignState feed (useCampaignFeed). These assertions pin BOTH halves so a
// future refactor can't silently swap the wrong one.
//
// The board composes ~10 hooks; mock them all so the test isolates the wiring.
// Role = BUYER keeps the STRATEGIST-gated panels unmounted (smaller surface).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useCampaignFeed.js', () => ({ useCampaignFeed: vi.fn() }));
vi.mock('@/hooks/useGrowthStrategySummary.js', () => ({ useGrowthStrategySummary: vi.fn() }));
vi.mock('@/hooks/useAccountBriefing.js', () => ({ useAccountBriefing: vi.fn() }));
vi.mock('@/hooks/usePromotePattern.js', () => ({ usePromotePattern: vi.fn() }));
vi.mock('@/hooks/useEconomics.js', () => ({ useEconomics: vi.fn(), useSaveEconomics: vi.fn() }));
vi.mock('@/hooks/useGoals.js', () => ({ useGoals: vi.fn() }));
vi.mock('@/hooks/usePlans.js', () => ({ usePlans: vi.fn() }));
vi.mock('@/hooks/useApprovals.js', () => ({ useApprovals: vi.fn() }));
vi.mock('@/hooks/useFatigueForecast.js', () => ({ useFatigueForecast: vi.fn() }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: vi.fn(),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));

import GrowthStrategyBoard from './InsightsView.jsx';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { useGrowthStrategySummary } from '@/hooks/useGrowthStrategySummary.js';
import { useAccountBriefing } from '@/hooks/useAccountBriefing.js';
import { usePromotePattern } from '@/hooks/usePromotePattern.js';
import { useEconomics, useSaveEconomics } from '@/hooks/useEconomics.js';
import { useGoals } from '@/hooks/useGoals.js';
import { usePlans } from '@/hooks/usePlans.js';
import { useFatigueForecast } from '@/hooks/useFatigueForecast.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';

// A legacy feed with one pending SCALE alert carrying one memory entry — so
// Strategic Bets and the Memory Layer have something legacy-sourced to render.
const legacyFeed = () => ({
  campaigns: [{
    campaign_id: 'Legacy Camp',
    stage: 'TESTING',
    alerts: [{
      action_id: 'a1',
      priority: 'HIGH',
      analysis: { verdict: 'SCALE', root_cause: 'rc' },
      action_plan: { status: 'PENDING', action: 'Scale the legacy bet' },
      memory: [{
        actionType: 'SCALE',
        decisionRationale: 'learned the legacy lesson',
        isSustainable: true,
        recordedAt: new Date().toISOString(),
      }],
    }],
  }],
  summary: { blendedCpa: null, pending: false, total: 3 },
  loading: false,
});

const growthSummary = (over = {}) => ({
  loading: false,
  error: null,
  summary: {
    total: 44, scaling: 5, holding: 2, watching: 0, killing: 1,
    // C-07 - the tile reads GROUPS, not a single count. The shape is what
    // useGrowthStrategySummary returns: one entry per reason, each already
    // carrying its own label and sentence.
    gated: [
      { reason: 'NO_MEASURABLE_DELIVERY', count: 1, label: 'with no measurable delivery', action: 'connect a revenue source so spend can be scored', sentence: '1 campaign with no measurable delivery - connect a revenue source so spend can be scored.', items: [] },
      { reason: 'CANONICAL_EVIDENCE_STALE', count: 2, label: 'measured too long ago to score today', action: 'sync again so the measurement is current', sentence: '2 campaigns measured too long ago to score today - sync again so the measurement is current.', items: [] },
    ],
    gatedTotal: 3,
    ...over,
  },
});

const renderBoard = () =>
  render(<MemoryRouter><GrowthStrategyBoard /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useCampaignFeed.mockReturnValue(legacyFeed());
  useGrowthStrategySummary.mockReturnValue(growthSummary());
  useAccountBriefing.mockReturnValue({ briefing: null, loading: false, error: null, refetch: vi.fn(), setConsent: vi.fn(), consentBusy: false });
  usePromotePattern.mockReturnValue({ promote: vi.fn(), promotingId: null, error: null });
  useEconomics.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
  useSaveEconomics.mockReturnValue({ save: vi.fn(), saving: false });
  useGoals.mockReturnValue({ goals: [], isLoading: false, error: null, createGoal: vi.fn(), isCreating: false });
  usePlans.mockReturnValue({ plans: [], isLoading: false, error: null, createPlan: vi.fn(), isCreating: false, getPlan: vi.fn(), promotePlan: vi.fn(), promotingId: null, submitForApproval: vi.fn(), submittingId: null });
  useFatigueForecast.mockReturnValue({ forecast: [], isLoading: false });
  useCollabRole.mockReturnValue({ role: 'BUYER', loading: false });
});

describe('GrowthStrategyBoard — Active Campaigns tile (connector-sourced)', () => {
  it('shows the connector total (44), not the legacy feed total (3)', () => {
    renderBoard();
    expect(screen.getByText('44')).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
  });

  it('renders the connector verdict breakdown (Scaling/Holding/Killing)', () => {
    renderBoard();
    expect(screen.getByText(/5 Scaling/)).toBeInTheDocument();
    expect(screen.getByText(/2 Holding/)).toBeInTheDocument();
    expect(screen.getByText(/1 Killing/)).toBeInTheDocument();
  });

  // C-07 - this asserted a single line, "3 need revenue data", over three
  // campaigns of which only one needed revenue. The other two needed a sync.
  it('surfaces gatedOut per REASON, never as one undifferentiated count', () => {
    renderBoard();
    expect(screen.getByText(/1 with no measurable delivery/)).toBeInTheDocument();
    expect(screen.getByText(/2 measured too long ago to score today/)).toBeInTheDocument();
    expect(screen.queryByText(/3 need revenue data/)).not.toBeInTheDocument();
  });

  it('shows "…" (not 0) while the connector summary is loading', () => {
    useGrowthStrategySummary.mockReturnValue(growthSummary({ total: 0, scaling: 0, holding: 0, killing: 0, gated: [], gatedTotal: 0 }));
    // flip to loading after seeding a zeroed summary
    useGrowthStrategySummary.mockReturnValue({ loading: true, error: null, summary: { total: 0, scaling: 0, holding: 0, watching: 0, killing: 0, gated: [], gatedTotal: 0 } });
    renderBoard();
    expect(screen.getByText('…')).toBeInTheDocument();
  });
});

describe('GrowthStrategyBoard — Bets + Memory stay on the legacy feed', () => {
  it('Strategic Bets render from the legacy feed alerts', () => {
    renderBoard();
    expect(screen.getByText('Scale the legacy bet')).toBeInTheDocument();
  });

  it('Memory Layer renders from the legacy feed DecisionMemory', () => {
    renderBoard();
    expect(screen.getByText('learned the legacy lesson')).toBeInTheDocument();
    expect(screen.getByText(/Memory Layer: 1 learning/)).toBeInTheDocument();
  });
});
