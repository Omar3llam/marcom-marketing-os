// ============================================================
// GrowthStrategyBoard — Active Campaigns tile is connector-sourced;
// the ACROSS axis has moved out; Strategic Bets are FE-03's
// ------------------------------------------------------------
// The Active Campaigns tile (count + verdict breakdown + "need revenue data")
// reads useGrowthStrategySummary — the connector substrate. That half is
// unchanged and still pinned here.
//
// FE-02 removed the OTHER half this file used to assert. "Bets + Memory stay on
// the legacy feed" was true of a mock and false of the product: GET /lumi/feed
// stopped publishing the `campaigns` array in S1-B, so both sections were
// structurally empty, and the Memory one said so in words. See the blocks below.
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

// ── R-M6 · STILL ON THE DELETED FIELD, and deliberately left there ──────
// `bets` reads campaigns[].alerts[] off useCampaignFeed, and `GET /lumi/feed`
// stopped publishing `campaigns` in S1-B. So in production this section always
// renders "No strategic bets active. Analyze your first campaign…" — a claim
// about the account derived from a field that no longer exists.
//
// This test is GREEN only because the mock below hands the board a shape the
// backend cannot send. That is named here rather than quietly relied on: bets
// are the SUBJECT axis, and FE-03 ("SUBJECT stops reading a deleted field")
// owns the repoint together with the other two useCampaignFeed consumers.
// FE-02 removed the ACROSS half and nothing else.
describe('GrowthStrategyBoard — Strategic Bets, still legacy-fed (FE-03 owns this)', () => {
  it('Strategic Bets render from the legacy feed alerts', () => {
    renderBoard();
    expect(screen.getByText('Scale the legacy bet')).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════
// FE-02 — the ACROSS axis has left this board
// ----------------------------------------------------------------------
// REPLACES "Memory Layer renders from the legacy feed DecisionMemory", which
// asserted `Memory Layer: 1 learning` against a mocked `campaigns` array. The
// assertion was true of the fixture and false of the product: with the real
// response the timeline was always empty, so the board told the operator
//
//     "The memory layer is empty. Lumi will learn from your campaigns…"
//
// while rendering, ~100 lines lower on the SAME page, the account's actual
// learned patterns from /api/lumi/briefing. Two claims about one object, one
// of them false, and a green test protecting the false one.
//
// Both halves now live at /app/memory. These assertions pin that they are GONE
// from here — a section that cannot be filled must not be re-added, and the
// briefing must not be rendered in two places (B7 Ruling 2).
// ══════════════════════════════════════════════════════════════════════
const realFeed = () => ({
  // The shape `GET /api/lumi/feed` actually returns: no `campaigns` key at all,
  // which useIntelligenceData resolves to [] via `feedData?.campaigns ?? []`.
  campaigns: [],
  summary: { blendedCpa: null, pending: false, total: 0 },
  loading: false,
});

describe('FE-02 · the memory layer is no longer claimed to be empty', () => {
  beforeEach(() => { useCampaignFeed.mockReturnValue(realFeed()); });

  it('makes no claim about what Lumi has learned', () => {
    const { container } = renderBoard();
    expect(container.textContent).not.toMatch(/memory layer is empty/i);
    expect(container.textContent).not.toMatch(/Memory Layer:/);
    expect(container.textContent).not.toMatch(/System Learnings/i);
  });

  it('does not render the account briefing — it has one destination now', () => {
    const { container } = renderBoard();
    expect(container.textContent).not.toMatch(/What Lumi Knows About This Account/i);
  });

  it('does not even read the briefing from here', () => {
    // The strongest form of the assertion: the hook is not called. A surface
    // that still fetches what it no longer shows is a second reader waiting to
    // become a second claim.
    renderBoard();
    expect(useAccountBriefing).not.toHaveBeenCalled();
  });
});
