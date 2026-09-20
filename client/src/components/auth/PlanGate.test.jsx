// ============================================================
// PlanGate — the plan-tier gating seam (sibling of RoleGate)
// ------------------------------------------------------------
// children when entitled, the upgrade wall when the plan was READ and is below
// the tier, and NOTHING while the plan loads (never a premature upgrade wall
// for a paying operator mid-load). usePlan is mocked so the gate is tested in
// isolation.
//
// Phase 5.9 — the third outcome. `fallback` is a BILLING CLAIM, so it may only
// follow a plan we actually read. These tests pin that a failed, refused,
// absent or unreadable entitlement renders absence instead, and still does not
// render children.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/usePlan.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, usePlan: vi.fn() };
});

import PlanGate from './PlanGate.jsx';
import { usePlan, WORKSPACE_READ } from '@/hooks/usePlan.js';

// Mirror the real hook: canAccess is a monotonic hierarchy check, and it
// answers false whenever the entitlement was not established.
const RANK = { FREE: 0, GROWTH: 1, PRO: 2 };
const mockPlan = (plan, loading = false, status = WORKSPACE_READ.PRESENT) => {
  const known = status === WORKSPACE_READ.PRESENT;
  usePlan.mockReturnValue({
    plan: known ? plan : null,
    loading,
    status,
    canAccess: (req) => (req == null ? true : known && (RANK[plan] ?? 0) >= (RANK[req] ?? 0)),
  });
};

const renderGate = () => render(
  <PlanGate required="GROWTH" fallback={<span>upgrade wall</span>}><span>unlocked</span></PlanGate>,
);

beforeEach(() => vi.clearAllMocks());

describe('PlanGate — a plan that WAS read', () => {
  it('renders children when the plan meets the required tier', () => {
    mockPlan('PRO');
    renderGate();
    expect(screen.getByText('unlocked')).toBeInTheDocument();
    expect(screen.queryByText('upgrade wall')).not.toBeInTheDocument();
  });

  it('renders the upgrade wall when the plan is below the required tier', () => {
    mockPlan('FREE');
    renderGate();
    expect(screen.getByText('upgrade wall')).toBeInTheDocument();
    expect(screen.queryByText('unlocked')).not.toBeInTheDocument();
  });

  it('renders NOTHING while the plan is loading (no flash of the upgrade wall)', () => {
    mockPlan('FREE', true);
    const { container } = renderGate();
    expect(screen.queryByText('unlocked')).not.toBeInTheDocument();
    expect(screen.queryByText('upgrade wall')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('a PRO plan still hits the wall for a tier above it (hierarchy, not identity)', () => {
    mockPlan('GROWTH');
    render(
      <PlanGate required="PRO" fallback={<span>upgrade wall</span>}><span>unlocked</span></PlanGate>,
    );
    expect(screen.getByText('upgrade wall')).toBeInTheDocument();
  });
});

describe('PlanGate — an entitlement that was NOT established', () => {
  const ABSENCES = [
    ['a failed read', WORKSPACE_READ.NOT_REACHABLE],
    ['a refused read', WORKSPACE_READ.NOT_PERMITTED],
    ['an absent workspace', WORKSPACE_READ.NOTHING_FOUND],
  ];

  it.each(ABSENCES)('%s never renders the upgrade wall', (_label, status) => {
    mockPlan(null, false, status);
    renderGate();
    expect(screen.queryByText('upgrade wall')).not.toBeInTheDocument();
  });

  it.each(ABSENCES)('%s never renders the children either — the gate still refuses', (_label, status) => {
    mockPlan(null, false, status);
    renderGate();
    expect(screen.queryByText('unlocked')).not.toBeInTheDocument();
  });

  it.each(ABSENCES)('%s says what happened instead of asking for money', (_label, status) => {
    mockPlan(null, false, status);
    renderGate();
    expect(screen.getByText(/couldn’t read this account/i)).toBeInTheDocument();
  });

  it('a PRO workspace whose read failed is NOT told to upgrade — the reported defect', () => {
    // Exactly Phase 5.8 probe R3: entitled operator, workspace read 500s.
    mockPlan('PRO', false, WORKSPACE_READ.NOT_REACHABLE);
    renderGate();
    expect(screen.queryByText('upgrade wall')).not.toBeInTheDocument();
    expect(screen.getByText(/couldn’t read this account/i)).toBeInTheDocument();
  });

  it('a refusal does not claim the failure is on our side; a failed read does', () => {
    mockPlan(null, false, WORKSPACE_READ.NOT_PERMITTED);
    const { unmount } = renderGate();
    expect(screen.queryByText(/problem on our side/i)).not.toBeInTheDocument();
    unmount();

    mockPlan(null, false, WORKSPACE_READ.NOT_REACHABLE);
    renderGate();
    expect(screen.getByText(/problem on our side/i)).toBeInTheDocument();
  });

  it('an explicit `unavailable` element overrides the default absence surface', () => {
    mockPlan(null, false, WORKSPACE_READ.NOT_REACHABLE);
    render(
      <PlanGate required="GROWTH" fallback={<span>upgrade wall</span>} unavailable={<span>custom absence</span>}>
        <span>unlocked</span>
      </PlanGate>,
    );
    expect(screen.getByText('custom absence')).toBeInTheDocument();
    expect(screen.queryByText('upgrade wall')).not.toBeInTheDocument();
  });

  it('REGRESSION: an ungated PlanGate still refuses on an unknown entitlement', () => {
    // `required` undefined is ungated for canAccess, but the gate must not use
    // that as a back door onto a surface whose entitlement we never read.
    mockPlan(null, false, WORKSPACE_READ.NOT_REACHABLE);
    render(<PlanGate><span>unlocked</span></PlanGate>);
    expect(screen.queryByText('unlocked')).not.toBeInTheDocument();
  });
});
