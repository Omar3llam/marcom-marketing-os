// ============================================================
// ApprovalsPanel — STRATEGIST decision queue (pure view)
// ------------------------------------------------------------
// Asserts honest loading/error/empty states, the row render (plan name + budget
// from minor), the TWO-CLICK approve (no one-click governance), and the
// request-revision flow (reason REQUIRED → REJECTED + reason).
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalsPanel } from './ApprovalsPanel.jsx';

const APPROVALS = [
  {
    id: 'req1', workspaceId: 'w1', planId: 'p1', subjectType: 'PLAN', subjectId: 'p1',
    requestedById: 'u1', state: 'PENDING', reason: null, decidedById: null, decidedAt: null,
    createdAt: new Date('2026-06-20'),
    plan: { id: 'p1', name: 'Q3 growth plan', periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-09-30'), totalBudgetMinor: 5000000, currency: 'USD', status: 'DRAFT' },
  },
];

describe('ApprovalsPanel — states', () => {
  it('shows a loading state', () => {
    render(<ApprovalsPanel loading />);
    expect(screen.getByText(/loading approvals/i)).toBeInTheDocument();
  });
  it('shows a mapped error', () => {
    render(<ApprovalsPanel error={new Error('boom')} />);
    expect(screen.getByText(/couldn’t load approvals/i)).toBeInTheDocument();
  });
  it('shows the honest empty state', () => {
    render(<ApprovalsPanel approvals={[]} />);
    expect(screen.getByText(/no plans awaiting your approval/i)).toBeInTheDocument();
  });
});

// ── Tier 2a · governance fails CLOSED ───────────────────────────────────────
// The consequence, not `unreadableCount === 1`: a queue holding an item it
// cannot read may not tell a STRATEGIST that nothing is awaiting them.
describe('ApprovalsPanel — an unreadable authorization is never an absent one', () => {
  it('does NOT claim the queue is empty when an item could not be read', () => {
    render(<ApprovalsPanel approvals={[]} unreadableCount={1} />);
    expect(screen.queryByText(/no plans awaiting your approval/i)).not.toBeInTheDocument();
  });

  it('says so, and says the item cannot be decided here', () => {
    render(<ApprovalsPanel approvals={[]} unreadableCount={2} />);
    expect(screen.getByText(/couldn’t be read/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be decided here/i)).toBeInTheDocument();
  });

  it('offers NO governance control for what it could not read', () => {
    const onDecide = vi.fn();
    render(<ApprovalsPanel approvals={[]} unreadableCount={1} onDecide={onDecide} />);
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request revision/i })).not.toBeInTheDocument();
  });

  it('readable rows stay decidable beside an unreadable one', () => {
    render(<ApprovalsPanel approvals={APPROVALS} unreadableCount={1} />);
    expect(screen.getByText('Q3 growth plan')).toBeInTheDocument();
    expect(screen.getByText(/couldn’t be read/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('a GENUINELY empty queue still says so, with no unreadable notice', () => {
    render(<ApprovalsPanel approvals={[]} unreadableCount={0} />);
    expect(screen.getByText(/no plans awaiting your approval/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn’t be read/i)).not.toBeInTheDocument();
  });
});

describe('ApprovalsPanel — row + decisions', () => {
  it('renders the plan name and budget (from minor)', () => {
    render(<ApprovalsPanel approvals={APPROVALS} />);
    expect(screen.getByText('Q3 growth plan')).toBeInTheDocument();
    expect(screen.getByText('$50,000.00')).toBeInTheDocument();
  });

  it('requires two clicks to approve (governance, never one-click)', () => {
    const onDecide = vi.fn();
    render(<ApprovalsPanel approvals={APPROVALS} onDecide={onDecide} />);
    const btn = screen.getByRole('button', { name: /^approve$/i });
    fireEvent.click(btn); // first click arms confirm — no decision yet
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirm approve/i }));
    expect(onDecide).toHaveBeenCalledWith('req1', 'APPROVED');
  });

  it('request-revision needs a reason and sends REJECTED + reason', () => {
    const onDecide = vi.fn();
    render(<ApprovalsPanel approvals={APPROVALS} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: /request revision/i }));
    const send = screen.getByRole('button', { name: /send revision request/i });
    expect(send).toBeDisabled(); // no reason yet
    fireEvent.change(screen.getByLabelText(/revision reason/i), { target: { value: 'Trim the budget 20%.' } });
    fireEvent.click(screen.getByRole('button', { name: /send revision request/i }));
    expect(onDecide).toHaveBeenCalledWith('req1', 'REJECTED', 'Trim the budget 20%.');
  });
});
