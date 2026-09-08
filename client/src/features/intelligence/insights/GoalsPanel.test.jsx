// ============================================================
// GoalsPanel — north-star goals list + STRATEGIST create (pure view)
// ------------------------------------------------------------
// Asserts honest loading/error/empty states, the goal-row render (metric +
// comparator symbol + target + persisted status badge), the STRATEGIST-gated
// create form, and that submit fires onCreate with the backend's payload shape.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GoalsPanel } from './GoalsPanel.jsx';

const GOALS = [
  { id: 'g1', workspaceId: 'w1', name: 'Q3 ROAS floor', metric: 'blendedRoas', comparator: 'GTE', targetValue: 2.5, currency: 'USD', periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-09-30'), status: 'ON_TRACK', planId: null },
  { id: 'g2', workspaceId: 'w1', name: 'CAC ceiling', metric: 'blendedCac', comparator: 'LTE', targetValue: 4000, currency: 'USD', periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-09-30'), status: 'OFF_TRACK', planId: null },
];

describe('GoalsPanel — states', () => {
  it('shows a loading state', () => {
    render(<GoalsPanel loading />);
    expect(screen.getByText(/loading goals/i)).toBeInTheDocument();
  });

  it('shows a mapped error (not a stack trace)', () => {
    render(<GoalsPanel error={new Error('boom')} />);
    expect(screen.getByText(/couldn’t load goals/i)).toBeInTheDocument();
  });

  it('shows the honest empty state when there are no goals', () => {
    render(<GoalsPanel goals={[]} canCreate />);
    expect(screen.getByText(/no goals set yet/i)).toBeInTheDocument();
  });
});

describe('GoalsPanel — list', () => {
  it('renders each goal with metric, comparator symbol, target and status', () => {
    render(<GoalsPanel goals={GOALS} />);
    expect(screen.getByText('Q3 ROAS floor')).toBeInTheDocument();
    expect(screen.getByText(/Blended ROAS ≥ 2\.5/)).toBeInTheDocument();
    expect(screen.getByText(/Blended CAC ≤ 4000/)).toBeInTheDocument();
    expect(screen.getByText('ON TRACK')).toBeInTheDocument();
    expect(screen.getByText('OFF TRACK')).toBeInTheDocument();
  });
});

describe('GoalsPanel — create (STRATEGIST gate)', () => {
  it('hides the create form for a non-strategist', () => {
    render(<GoalsPanel goals={GOALS} canCreate={false} />);
    expect(screen.queryByRole('button', { name: /create goal/i })).not.toBeInTheDocument();
  });

  it('a strategist can create; submit fires onCreate with the backend payload shape', () => {
    const onCreate = vi.fn().mockResolvedValue({ id: 'g3' });
    render(<GoalsPanel goals={GOALS} canCreate onCreate={onCreate} currency="USD" />);

    fireEvent.change(screen.getByLabelText(/target value/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: /create goal/i }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      metric: 'blendedRoas',
      comparator: 'GTE',
      targetValue: 3,
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
      currency: 'USD',
    }));
  });

  it('keeps Create disabled until the target + valid period are entered', () => {
    render(<GoalsPanel goals={GOALS} canCreate onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create goal/i })).toBeDisabled();
  });
});

// ── Tier 2b · an unreadable row is never an absent one ──────────────────────
// The consequence, not the entry shape: a list holding a row it could not read
// may not claim to be empty, and may not quietly render one row short.
describe('GoalsPanel — unreadable rows keep their place', () => {
  const rows = (states) => states.map((state, index) => (
    state === 'UNREADABLE'
      ? { state: 'UNREADABLE', index, value: null }
      : { state: 'READABLE', index, value: GOALS[index] }
  ));

  it('does NOT claim "No goals set yet" when a row could not be read', () => {
    render(<GoalsPanel goals={[]} goalRows={rows(['UNREADABLE'])} />);
    expect(screen.queryByText(/no goals set yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn’t be read/i)).toBeInTheDocument();
  });

  it('keeps the gap open between two readable rows', () => {
    render(<GoalsPanel goals={GOALS} goalRows={[
      { state: 'READABLE', index: 0, value: GOALS[0] },
      { state: 'UNREADABLE', index: 1, value: null },
      { state: 'READABLE', index: 2, value: GOALS[1] },
    ]} />);
    expect(screen.getByText('Q3 ROAS floor')).toBeInTheDocument();
    expect(screen.getByText('CAC ceiling')).toBeInTheDocument();
    expect(screen.getByText(/couldn’t be read/i)).toBeInTheDocument();
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('a GENUINELY empty list still says so, with nothing marked', () => {
    render(<GoalsPanel goals={[]} goalRows={[]} />);
    expect(screen.getByText(/no goals set yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t be read/i)).not.toBeInTheDocument();
  });

  it('and a panel given no rows at all still renders from goals (back-compat)', () => {
    render(<GoalsPanel goals={GOALS} />);
    expect(screen.getByText('Q3 ROAS floor')).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t be read/i)).not.toBeInTheDocument();
  });
});
