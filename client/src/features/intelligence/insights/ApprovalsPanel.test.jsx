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
