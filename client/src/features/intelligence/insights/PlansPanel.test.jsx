// ============================================================
// PlansPanel — plans list + create + live tracking + promote (pure view)
// ------------------------------------------------------------
// Asserts honest loading/error/empty states, the plan-row render (budget from
// minor units + status badge), lazy expand → goal-tracker landing rendered as a
// RANGE (never a point), the STRATEGIST gate on create/promote, and the
// budget→minor conversion on build.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlansPanel } from './PlansPanel.jsx';

const PLANS = [
  { id: 'p1', workspaceId: 'w1', name: 'Q3 growth plan', periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-09-30'), totalBudgetMinor: 5000000, currency: 'USD', status: 'DRAFT', channelMix: [], testingAgenda: [], projections: { scenario: null, economics: null, goalLanding: null }, memoryBasis: [], allocationPlanId: null, goals: [] },
];

const DETAIL = {
  ...PLANS[0],
  tracking: {
    refreshedAt: '2026-08-01T00:00:00.000Z',
    goals: [
      { goalId: 'g1', metric: 'blendedRoas', landing: {
        metric: 'blendedRoas',
        target: { comparator: 'GTE', targetValue: 2.5, spendCeilingMinor: null },
        paceToDate: 2.1,
        trendBasedLandingEstimate: { low: 2.2, expected: 2.6, high: 3.0 },
        laggingStatus: 'AT_RISK', leadingRisk: false, leadingSignals: [],
        status: 'AT_RISK', pctOfPeriodElapsed: 0.5,
        assumptions: ['linear-trend estimate; real curves bend'], basis: 'trend-based',
      } },
    ],
  },
};

describe('PlansPanel — states', () => {
  it('shows a loading state', () => {
    render(<PlansPanel loading />);
    expect(screen.getByText(/loading plans/i)).toBeInTheDocument();
  });
  it('shows a mapped error', () => {
    render(<PlansPanel error={new Error('boom')} />);
    expect(screen.getByText(/couldn’t load plans/i)).toBeInTheDocument();
  });
  it('shows the honest empty state', () => {
    render(<PlansPanel plans={[]} canManage />);
    expect(screen.getByText(/no plans yet/i)).toBeInTheDocument();
  });
});

describe('PlansPanel — list + expand', () => {
  it('renders the plan with budget (from minor) and status', () => {
    render(<PlansPanel plans={PLANS} />);
    expect(screen.getByText('Q3 growth plan')).toBeInTheDocument();
    expect(screen.getByText('$50,000.00')).toBeInTheDocument(); // 5,000,000 minor
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });

  it('lazy-loads tracking on expand and renders the landing as a RANGE (not a point)', async () => {
    const getPlanDetail = vi.fn().mockResolvedValue(DETAIL);
    render(<PlansPanel plans={PLANS} getPlanDetail={getPlanDetail} />);
    fireEvent.click(screen.getByRole('button', { name: /Q3 growth plan/i }));
    await waitFor(() => expect(getPlanDetail).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText(/2\.2–3/)).toBeInTheDocument();      // low–high range
    expect(screen.getByText(/expected 2\.6/)).toBeInTheDocument();      // expected, alongside range
    expect(screen.getByText('AT RISK')).toBeInTheDocument();
  });
});

describe('PlansPanel — approval gate (Phase 6B)', () => {
  it('shows the reflected approval status badge on the row', () => {
    const pending = [{ ...PLANS[0], approvalState: 'PENDING', requiresApproval: true }];
    render(<PlansPanel plans={pending} />);
    expect(screen.getByText(/awaiting approval/i)).toBeInTheDocument();
  });

  it('offers "Submit for approval" when no gate is open and the seat can submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ id: 'req1' });
    const getPlanDetail = vi.fn().mockResolvedValue({ ...DETAIL, approvalState: null, requiresApproval: false, latestApproval: null });
    render(<PlansPanel plans={PLANS} canSubmit onSubmit={onSubmit} getPlanDetail={getPlanDetail} />);
    fireEvent.click(screen.getByRole('button', { name: /Q3 growth plan/i }));
    const submit = await screen.findByRole('button', { name: /submit for approval/i });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('p1');
  });

  it('blocks promote while the gate is open (requiresApproval, not APPROVED)', async () => {
    const blocked = [{ ...PLANS[0], approvalState: 'PENDING', requiresApproval: true }];
    const getPlanDetail = vi.fn().mockResolvedValue({ ...DETAIL, approvalState: 'PENDING', requiresApproval: true });
    render(<PlansPanel plans={blocked} canManage getPlanDetail={getPlanDetail} onPromote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Q3 growth plan/i }));
    const promote = await screen.findByRole('button', { name: /promote mix/i });
    expect(promote).toBeDisabled();
    expect(screen.getByText(/blocked until approved/i)).toBeInTheDocument();
  });
});

describe('PlansPanel — STRATEGIST gate', () => {
  it('hides the build form for a non-manager', () => {
    render(<PlansPanel plans={PLANS} canManage={false} />);
    expect(screen.queryByRole('button', { name: /build plan/i })).not.toBeInTheDocument();
  });

  it.each(['EGP', 'USD', 'SAR'])('a strategist selects %s and submits that denomination unchanged', (currency) => {
    const onCreate = vi.fn().mockResolvedValue({ id: 'p2' });
    render(<PlansPanel plans={PLANS} canManage onCreate={onCreate} currency="USD" />);
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('');
    fireEvent.change(screen.getByRole('combobox', { name: 'Currency' }), { target: { value: currency } });
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: /build plan/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      totalBudgetMinor: 5000000, periodStart: '2026-07-01', periodEnd: '2026-09-30', totalBudgetCurrency: currency,
    }));
  });

  it('requires a visible choice even when an inferred currency prop is supplied', () => {
    const onCreate = vi.fn();
    render(<PlansPanel canManage onCreate={onCreate} currency="USD" />);
    fireEvent.change(screen.getByLabelText(/total budget/i), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2026-09-30' } });
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('');
    expect(screen.getByRole('button', { name: /build plan/i })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('keeps a monetary 409 refusal visible without hiding the form or list', () => {
    render(<PlansPanel plans={PLANS} canManage createError={{ context: { reason: 'BUDGET_CURRENCY_MISMATCH' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('BUDGET_CURRENCY_MISMATCH');
    expect(screen.getByRole('button', { name: /build plan/i })).toBeInTheDocument();
    expect(screen.getByText('Q3 growth plan')).toBeInTheDocument();
  });

  it('shows the promote control (STRATEGIST) inside an expanded plan', async () => {
    const getPlanDetail = vi.fn().mockResolvedValue(DETAIL);
    render(<PlansPanel plans={PLANS} canManage getPlanDetail={getPlanDetail} onPromote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Q3 growth plan/i }));
    expect(await screen.findByRole('button', { name: /promote mix/i })).toBeInTheDocument();
  });
});

// ── Tier 2b · an unreadable row is never an absent one ──────────────────────
// The consequence, not the entry shape: a list holding a row it could not read
// may not claim to be empty, and may not quietly render one row short.
describe('PlansPanel — unreadable rows keep their place', () => {
  it('does NOT claim "No plans yet" when a row could not be read', () => {
    render(<PlansPanel plans={[]} planRows={[{ state: 'UNREADABLE', index: 0, value: null }]} />);
    expect(screen.queryByText(/no plans yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn’t be read/i)).toBeInTheDocument();
  });

  it('keeps a readable plan beside an unreadable one', () => {
    render(<PlansPanel plans={PLANS} planRows={[
      { state: 'READABLE', index: 0, value: PLANS[0] },
      { state: 'UNREADABLE', index: 1, value: null },
    ]} />);
    expect(screen.getByText(PLANS[0].name)).toBeInTheDocument();
    expect(screen.getByText(/couldn’t be read/i)).toBeInTheDocument();
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('a GENUINELY empty list still says so', () => {
    render(<PlansPanel plans={[]} planRows={[]} />);
    expect(screen.getByText(/no plans yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t be read/i)).not.toBeInTheDocument();
  });

  it('and a panel given no rows at all still renders from plans (back-compat)', () => {
    render(<PlansPanel plans={PLANS} />);
    expect(screen.getByText(PLANS[0].name)).toBeInTheDocument();
  });
});
