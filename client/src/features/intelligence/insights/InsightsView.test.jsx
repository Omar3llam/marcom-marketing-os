// ============================================================
// GrowthStrategyBoard — one substrate left, and it is the connector graph
// ------------------------------------------------------------
// The Active Campaigns tile (count + verdict breakdown + "need revenue data")
// reads useGrowthStrategySummary — the connector substrate. That half was
// always live and is still pinned here.
//
// This file used to assert the other half too, under the title "Bets + Memory
// stay on the legacy feed". That was true of a mock and false of the product:
// GET /lumi/feed stopped publishing the `campaigns` array in S1-B, so both
// sections were structurally empty for every workspace.
//
//   FE-02 removed the MEMORY half — the one that said so out loud.
//   FE-03 removes the BETS half, and the Blended CPA tile beside it.
//
// The board composes ~10 hooks; mock them all so the test isolates the wiring.
// Role = BUYER keeps the STRATEGIST-gated panels unmounted (smaller surface).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
import { useGrowthStrategySummary } from '@/hooks/useGrowthStrategySummary.js';
import { useAccountBriefing } from '@/hooks/useAccountBriefing.js';
import { usePromotePattern } from '@/hooks/usePromotePattern.js';
import { useEconomics, useSaveEconomics } from '@/hooks/useEconomics.js';
import { useGoals } from '@/hooks/useGoals.js';
import { usePlans } from '@/hooks/usePlans.js';
import { useFatigueForecast } from '@/hooks/useFatigueForecast.js';
import { useApprovals } from '@/hooks/useApprovals.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';

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
  useGrowthStrategySummary.mockReturnValue(growthSummary());
  useAccountBriefing.mockReturnValue({ briefing: null, loading: false, error: null, refetch: vi.fn(), setConsent: vi.fn(), consentBusy: false });
  usePromotePattern.mockReturnValue({ promote: vi.fn(), promotingId: null, error: null });
  useEconomics.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
  useSaveEconomics.mockReturnValue({ save: vi.fn(), saving: false });
  useGoals.mockReturnValue({ goals: [], isLoading: false, error: null, createGoal: vi.fn(), isCreating: false });
  usePlans.mockReturnValue({ plans: [], isLoading: false, error: null, createPlan: vi.fn(), isCreating: false, getPlan: vi.fn(), promotePlan: vi.fn(), promotingId: null, submitForApproval: vi.fn(), submittingId: null });
  useFatigueForecast.mockReturnValue({ forecast: [], isLoading: false });
  useApprovals.mockReturnValue({
    pendingApprovals: [], unreadableCount: 0, isLoading: false, error: null,
    decide: vi.fn(), decidingId: null, refetch: vi.fn(),
  });
  useCollabRole.mockReturnValue({ role: 'BUYER', loading: false });
});

// ── Tier 2a · the wiring, not just the panel ────────────────────────────────
// A mutation that deleted `unreadableCount={unreadableCount}` from this view
// SURVIVED the hook and panel suites: both were green while the value the hook
// computed reached nothing. That is B6-01's finding — an exported state is not
// a read one — and PARITY-04's, one layer up. It is caught here.
describe('GrowthStrategyBoard — the approvals queue is wired, not merely exported', () => {
  it('an unreadable authorization reaches the STRATEGIST through the view', () => {
    useCollabRole.mockReturnValue({ role: 'STRATEGIST', loading: false });
    useApprovals.mockReturnValue({
      pendingApprovals: [], unreadableCount: 1, isLoading: false, error: null,
      decide: vi.fn(), decidingId: null, refetch: vi.fn(),
    });
    renderBoard();
    expect(screen.getByText(/couldn’t be read/i)).toBeInTheDocument();
    expect(screen.queryByText(/no plans awaiting your approval/i)).not.toBeInTheDocument();
  });

  it('…and a genuinely empty queue still says so through the same wiring', () => {
    useCollabRole.mockReturnValue({ role: 'STRATEGIST', loading: false });
    renderBoard();
    expect(screen.getByText(/no plans awaiting your approval/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t be read/i)).not.toBeInTheDocument();
  });
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
describe('FE-02 · the memory layer is no longer claimed to be empty', () => {
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

// ══════════════════════════════════════════════════════════════════════
// FE-03 — the SUBJECT half has left this board too
// ----------------------------------------------------------------------
// REPLACES "Strategic Bets render from the legacy feed alerts", which passed
// only because the fixture handed the board a `campaigns` array the backend
// cannot send. In production the strip rendered "No strategic bets active.
// Analyze your first campaign to generate strategic recommendations." and the
// Blended CPA tile read "— · No campaigns yet" — two claims about an account,
// made from a field that does not exist.
//
// Deleted, not repointed: a "bet" was a PENDING Action, and no Action row has
// been minted since B3-C. What these assertions pin is that neither claim can
// come back without a substrate that can answer for it.
// ══════════════════════════════════════════════════════════════════════
describe('FE-03 · no claim is made from the retired feed', () => {
  it('offers no Strategic Bets strip, empty or otherwise', () => {
    const { container } = renderBoard();
    expect(container.textContent).not.toMatch(/Strategic Bets/i);
    expect(container.textContent).not.toMatch(/No strategic bets active/i);
    expect(container.textContent).not.toMatch(/Analyze your first campaign/i);
  });

  it('offers no Blended CPA tile — the number had no source', () => {
    const { container } = renderBoard();
    expect(container.textContent).not.toMatch(/Blended CPA/i);
    expect(container.textContent).not.toMatch(/No campaigns yet/i);
  });

  it('still renders the tile that DOES have a live source', () => {
    // The self-refutation for the two assertions above: they must be failing to
    // find copy because it was removed, not because the board stopped rendering.
    renderBoard();
    expect(screen.getByText('Active Campaigns')).toBeInTheDocument();
    expect(screen.getByText('44')).toBeInTheDocument();
  });
});
