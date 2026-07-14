// ============================================================
// PlanGate — the plan-tier gating seam (sibling of RoleGate)
// ------------------------------------------------------------
// children when entitled, fallback when not, and NOTHING while the plan loads
// (never a premature upgrade wall for a paying operator mid-load). usePlan is
// mocked so the gate is tested in isolation.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/usePlan.js', () => ({ usePlan: vi.fn() }));

import PlanGate from './PlanGate.jsx';
import { usePlan } from '@/hooks/usePlan.js';

// Mirror the real hook: canAccess is a monotonic hierarchy check.
const RANK = { FREE: 0, GROWTH: 1, PRO: 2 };
const mockPlan = (plan, loading = false) =>
  usePlan.mockReturnValue({
    plan, loading,
    canAccess: (req) => req == null || (RANK[plan] ?? 0) >= (RANK[req] ?? 0),
  });

beforeEach(() => vi.clearAllMocks());

describe('PlanGate', () => {
  it('renders children when the plan meets the required tier', () => {
    mockPlan('PRO');
    render(<PlanGate required="GROWTH" fallback={<span>locked</span>}><span>unlocked</span></PlanGate>);
    expect(screen.getByText('unlocked')).toBeInTheDocument();
    expect(screen.queryByText('locked')).not.toBeInTheDocument();
  });

  it('renders the fallback when the plan is below the required tier', () => {
    mockPlan('FREE');
    render(<PlanGate required="GROWTH" fallback={<span>locked</span>}><span>unlocked</span></PlanGate>);
    expect(screen.getByText('locked')).toBeInTheDocument();
    expect(screen.queryByText('unlocked')).not.toBeInTheDocument();
  });

  it('renders NOTHING while the plan is loading (no flash of the upgrade wall)', () => {
    mockPlan('FREE', true);
    const { container } = render(
      <PlanGate required="GROWTH" fallback={<span>locked</span>}><span>unlocked</span></PlanGate>,
    );
    expect(screen.queryByText('unlocked')).not.toBeInTheDocument();
    expect(screen.queryByText('locked')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
