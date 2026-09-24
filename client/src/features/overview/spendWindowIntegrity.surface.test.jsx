// ============================================================
// Spend-Window Integrity · RED — the truth surface
// ------------------------------------------------------------
// The server now refuses a spend-to-budget comparison it cannot ground in a
// matching period. A refusal that reaches a person as a number, a zero, a vague
// "not enough data", or a card that silently vanishes has not reached them at
// all. Each case below pins what the operator actually reads.
//
// ⚠️ Paired on purpose: a genuinely measured OVER must still render as OVER, so
// an implementation that blanks the widget for everyone cannot pass.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PROMOTION_OUTCOME } from '@marcom/runtime-contracts';
import { formatCurrency } from '@/lib/money';
import { PortfolioViewSchema } from '@/contracts/schemas/portfolio.schema';
import { AllocationPlanPreviewSchema } from '@/contracts/schemas/allocationPlan.schema';

const seam = vi.hoisted(() => ({
  portfolio: { data: null, loading: false, error: null },
  workspace: { workspace: { currency: 'USD' } },
  role: { role: 'STRATEGIST', loading: false },
}));

vi.mock('@/hooks/usePortfolio.js', () => ({ usePortfolio: () => seam.portfolio }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => seam.workspace }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => seam.role,
  WORKSPACE_ROLE: { CLIENT: 'CLIENT', BUYER: 'BUYER', STRATEGIST: 'STRATEGIST' },
}));

import PacingWidget from './components/PacingWidget.jsx';
import { AllocationPanel } from '../intelligence/blended-truth/AllocationPanel.jsx';
import { promotionCopyFor } from '../intelligence/insights/promotionCopy.js';

const NOT_MEASURABLE_PERIOD = {
  status: 'NOT_MEASURABLE',
  reason: 'WINDOW_MISMATCH',
  period: { start: '2026-09-01', end: '2026-09-30' },
  window: null,
  daysCovered: null,
  spendMinor: null,
};

const view = (over = {}) => ({
  workspaceId: 'ws',
  generatedAt: '2026-09-13T12:00:00.000Z',
  monthlyBudgetMinor: 3_000_000,
  monthlyBudgetCurrency: 'USD',
  pacingMonetaryStatus: 'MONETARY_VALID',
  totals: null,
  pacing: null,
  spendPeriod: NOT_MEASURABLE_PERIOD,
  // Full BlendedChannel rows. My first version omitted the required fields, so
  // the parse case failed on the FIXTURE — which proves nothing about the refusal.
  channels: ['a', 'b'].map((channelId) => ({
    channelId, channel: 'META', name: null, currency: 'USD',
    spendMinor: 45_000, platformRevenueMinor: 90_000, actualRevenueMinor: null,
    blendedRevenueMinor: 90_000, gapMinor: 0, gapPct: 0, platformRoas: 2, blendedRoas: 2,
    coverage: 'UNVERIFIED', confidence: 'LOW', pacing: null,
  })),
  ...over,
});

const renderPacing = (data) => {
  seam.portfolio = { data, loading: false, error: null };
  return render(<MemoryRouter><PacingWidget /></MemoryRouter>).container.textContent;
};

beforeEach(() => {
  seam.role = { role: 'STRATEGIST', loading: false };
});

describe('the contract carries the refusal', () => {
  it('a NOT_MEASURABLE spend period parses — a refusal must not kill the surface', () => {
    const parsed = PortfolioViewSchema.safeParse(view());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.spendPeriod?.status, 'the refusal must survive parsing, not be stripped').toBe('NOT_MEASURABLE');
  });

  it('preserves a mixed-currency portfolio refusal through validation', () => {
    const parsed = PortfolioViewSchema.safeParse(view({
      monthlyBudgetCurrency: 'USD',
      pacingMonetaryStatus: 'MONETARY_UNAVAILABLE_MIXED',
      pacingMonetaryReason: 'SPEND_CURRENCY_MIXED',
      totals: {
        spendMinor: null, platformRevenueMinor: null, blendedRevenueMinor: null,
        blendedRoas: null, platformRoas: null, gapMinor: null, gapPct: null,
        reconciledCount: 0, unverifiedCount: 2,
        currency: null, monetaryStatus: 'MONETARY_UNAVAILABLE_MIXED',
        monetaryReason: 'SPEND_CURRENCY_MIXED',
      },
    }));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.pacingMonetaryStatus).toBe('MONETARY_UNAVAILABLE_MIXED');
    expect(parsed.data?.totals?.spendMinor).toBeNull();
  });

  it('an allocation with no measurable moves parses', () => {
    const parsed = AllocationPlanPreviewSchema.safeParse({
      goal: { type: 'GROWTH_CEILING', value: null },
      totalBudgetMinor: 3_000_000,
      currency: 'USD',
      efficiencyStatus: 'UNAVAILABLE', efficiencyReason: 'MEASUREMENT_WINDOW_UNKNOWN',
      spendPeriod: NOT_MEASURABLE_PERIOD,
      allocations: [{
        channelId: 'a', channel: 'META', verdict: 'HOLD', blendedRoas: 2,
        currentSpendMinor: null, recommendedSpendMinor: null, deltaMinor: null, rationale: 'x',
      }],
      projected: { blendedRevenueMinor: null, projectedCpaMinor: null, blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null },
      reasoningTrail: [],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

describe('Attention · pacing says what it cannot measure', () => {
  it('renders the refusal — visibly, and not as "not enough data"', () => {
    const text = renderPacing(view());
    expect(text, 'the card must not vanish').toMatch(/budget pacing/i);
    expect(text).toMatch(/this month/i);
    expect(text).toMatch(/measur/i);
    expect(text).not.toMatch(/not enough data/i);
  });

  it('prints no figure and no verdict it does not have', () => {
    const text = renderPacing(view());
    expect(text).not.toMatch(/over budget|under budget|on track/i);
    expect(text).not.toMatch(/run rate|projected|exhausts/i);
    expect(text).not.toContain(formatCurrency(0, 'USD'));
  });

  it('an unrecognised reason still refuses, without guessing a cause', () => {
    const text = renderPacing(view({ spendPeriod: { ...NOT_MEASURABLE_PERIOD, reason: 'SOMETHING_NEW' } }));
    expect(text).toMatch(/measur/i);
    expect(text).not.toMatch(/over budget|run rate/i);
  });

  it('control — a genuinely measured OVER still renders as OVER', () => {
    const text = renderPacing(view({
      spendPeriod: {
        status: 'MEASURABLE', reason: null, period: { start: '2026-09-01', end: '2026-09-30' },
        window: { start: '2026-09-01', end: '2026-09-12' }, daysCovered: 12, spendMinor: 2_880_000,
        currency: 'USD',
      },
      pacing: {
        runRateMinor: 240_000, projectedSpendMinor: 7_200_000, paceRatio: 2.4,
        daysRemaining: 17, exhaustsOnDay: 12.5, daysEarly: 17.5, status: 'OVER',
      },
    }));
    expect(text).toMatch(/over budget/i);
    expect(text).toMatch(/run rate/i);
  });
});

describe('Reallocate capital · no move is printed that was not measured', () => {
  const plan = {
    goal: { type: 'GROWTH_CEILING', value: null }, totalBudgetMinor: 3_000_000, currency: 'USD',
    spendPeriod: NOT_MEASURABLE_PERIOD,
    allocations: [
      { channelId: 'a', channel: 'Meta A', verdict: 'HOLD', blendedRoas: 2, currentSpendMinor: null, recommendedSpendMinor: null, deltaMinor: null, rationale: 'x' },
      { channelId: 'b', channel: 'Meta B', verdict: 'HOLD', blendedRoas: 2, currentSpendMinor: null, recommendedSpendMinor: null, deltaMinor: null, rationale: 'x' },
    ],
    efficiencyStatus: 'UNAVAILABLE', efficiencyReason: 'MEASUREMENT_WINDOW_UNKNOWN',
    projected: { blendedRevenueMinor: null, projectedCpaMinor: null, blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null },
    reasoningTrail: [],
  };

  it('says the period is not measured and prints no zero move', () => {
    const { container } = render(<AllocationPanel currency="USD" plan={plan} canCommit />);
    const text = container.textContent;
    expect(text).toMatch(/measur/i);
    expect(text).not.toContain(formatCurrency(0, 'USD'));
  });

  it('a commit that recorded the budget but staged no moves does not send anyone to Decisions', () => {
    const { container } = render(
      <AllocationPanel currency="USD" plan={plan} canCommit committed={{ decisionsCreated: 0, planId: 'p' }} />,
    );
    const text = container.textContent;
    expect(text).not.toMatch(/0 proposed moves/i);
    expect(text).not.toMatch(/confirm them in decisions/i);
  });
});

describe('Plans · promotion never claims a match nobody measured', () => {
  it('names the unmeasured outcome and sends nobody to the Decisions queue', () => {
    const copy = promotionCopyFor({
      outcome: PROMOTION_OUTCOME.PROMOTED_MOVES_NOT_MEASURABLE ?? 'PROMOTED_MOVES_NOT_MEASURABLE',
      decisionsCreated: 0,
      promotedAt: '2026-09-13T10:00:00.000Z',
    });
    expect(copy.message).toMatch(/measur/i);
    expect(copy.message).not.toMatch(/already matches/i);
    expect(copy.message).not.toMatch(/Decisions/);
  });
});
