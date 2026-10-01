// ============================================================
// Sidebar — mobile drawer visibility responds to mobileMenuOpen
// ------------------------------------------------------------
// Regression guard for the dead mobile drawer: the <aside> used to carry an
// UNCONDITIONAL `hidden`, which is display:none and made the translate-x toggle
// inert — the hamburger opened the backdrop but no panel ever slid in. Visibility
// is now gated on mobileMenuOpen:
//   • closed on mobile → `hidden` wins (panel display:none, off-screen)
//   • open           → `flex` (no `hidden`) so the existing transform slides it in
//   • desktop (lg+)  → always resolves to flex, regardless of drawer state
// Heavy/side-effectful children + the auth/workspace hooks are stubbed so the test
// only exercises the <aside> class resolution (cn = twMerge → last display wins).
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext.jsx', () => ({
  useAuth: () => ({ currentUser: { email: 'op@ws.com', displayName: 'Op' } }),
}));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: vi.fn(() => ({ role: 'STRATEGIST' })),
}));
// Partial: usePlan.js re-exports WORKSPACE_READ from here, so a whole-module
// factory would leave that re-export undefined in every consumer.
vi.mock('@/hooks/useWorkspace.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useWorkspace: vi.fn(() => ({ workspace: { name: 'Acme', market: 'EG' }, hasWorkspace: true, loading: false, status: 'PRESENT' })),
}));
// Default the workspace to PRO so every role-visible item is unlocked (a link) —
// the existing badge/label assertions below expect interactive nav items. The
// plan-gating suite at the bottom overrides this per-test.
// Partial mock: the Sidebar also reads the real WORKSPACE_READ tokens to tell
// a KNOWN entitlement from an unread one, so the module's other exports must
// survive (Phase 5.9).
vi.mock('@/hooks/usePlan.js', async (importOriginal) => ({
  ...(await importOriginal()),
  // 'PRESENT' spelled literally: vi.mock factories are hoisted above imports,
  // so WORKSPACE_READ.PRESENT is not in scope here. Same value.
  usePlan: vi.fn(() => ({ canAccess: () => true, loading: false, status: 'PRESENT' })),
}));
vi.mock('@/hooks/useConnections.js', () => ({
  useConnections: vi.fn(() => ({ data: null, loading: false, error: null })),
}));
vi.mock('@/hooks/usePendingApprovals.js', () => ({
  usePendingApprovals: vi.fn(() => ({ pending: [], loading: false, error: null, refetch: vi.fn() })),
}));
vi.mock('@/components/ui/NotificationBell.jsx', () => ({ default: () => null }));
vi.mock('@/features/inbox/InboxPanel.jsx', () => ({ default: () => null }));
vi.mock('@/components/ui/RecentDecisions.jsx', () => ({ default: () => null }));
vi.mock('@/components/ui/CommandPalette.jsx', () => ({ default: () => null }));
vi.mock('./RadarStrip.jsx', () => ({ default: () => null }));
vi.mock('@/components/brand/LumiStar.jsx', () => ({ default: () => null }));

import Sidebar from './Sidebar.jsx';
import { useConnections } from '@/hooks/useConnections.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { usePendingApprovals } from '@/hooks/usePendingApprovals.js';
import { usePlan, WORKSPACE_READ } from '@/hooks/usePlan.js';
import { useWorkspace } from '@/hooks/useWorkspace.js';

// Mirror the real hierarchy so a mocked plan locks exactly what usePlan would.
const PLAN_RANK = { FREE: 0, GROWTH: 1, PRO: 2 };
const setPlan = (tier) => usePlan.mockReturnValue({
  canAccess: (req) => req == null || (PLAN_RANK[tier] ?? 0) >= (PLAN_RANK[req] ?? 0),
  loading: false,
  // A tier only gates once it has actually been READ (Phase 5.9).
  status: WORKSPACE_READ.PRESENT,
});

function renderSidebar(props = {}, { path = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar collapsed={false} onToggle={() => {}} onMobileMenuToggle={() => {}} {...props} />
    </MemoryRouter>,
  );
}

// Reset the overridable mocks to their defaults after each test (this file mutates
// per-test return values, so leaking state would make later tests order-dependent).
afterEach(() => {
  useWorkspace.mockReturnValue({ workspace: { name: 'Acme', market: 'EG' }, hasWorkspace: true, loading: false, status: WORKSPACE_READ.PRESENT });
  useCollabRole.mockReturnValue({ role: 'STRATEGIST' });
  useConnections.mockReturnValue({ data: null, loading: false, error: null });
  usePendingApprovals.mockReturnValue({ pending: [], loading: false, error: null, refetch: vi.fn() });
  usePlan.mockReturnValue({ canAccess: () => true, loading: false, status: WORKSPACE_READ.PRESENT }); // back to PRO/unlocked
});

describe('Sidebar — workspace truth boundary', () => {
  it('keeps persisted workspace and market values; does not invent a market or liveness', () => {
    const { getByText, queryByText, rerender } = renderSidebar();
    expect(getByText('Acme')).toBeInTheDocument();
    expect(getByText('EG')).toBeInTheDocument();
    expect(queryByText('WATCHING')).not.toBeInTheDocument();

    useWorkspace.mockReturnValue({ workspace: { name: 'Acme', market: null }, hasWorkspace: true, loading: false, status: WORKSPACE_READ.PRESENT });
    rerender(<MemoryRouter><Sidebar collapsed={false} onToggle={() => {}} onMobileMenuToggle={() => {}} /></MemoryRouter>);
    expect(getByText('Acme')).toBeInTheDocument();
    expect(queryByText('Market:')).not.toBeInTheDocument();
    expect(queryByText('EG')).not.toBeInTheDocument();
    expect(queryByText('WATCHING')).not.toBeInTheDocument();
  });

  it('offers setup only after a successful absence finding', () => {
    useWorkspace.mockReturnValue({ workspace: null, hasWorkspace: false, loading: false, status: WORKSPACE_READ.NOTHING_FOUND });
    const { getByText, queryByRole } = renderSidebar();
    expect(getByText('Create Workspace')).toBeInTheDocument();
    expect(queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each([WORKSPACE_READ.NOT_REACHABLE, WORKSPACE_READ.NOT_PERMITTED])('shows %s without an absence/setup affordance', (status) => {
    useWorkspace.mockReturnValue({ workspace: null, hasWorkspace: false, loading: false, status });
    const { queryByText, getByRole } = renderSidebar();
    expect(queryByText('Create Workspace')).not.toBeInTheDocument();
    expect(getByRole('alert')).toHaveTextContent(status === WORKSPACE_READ.NOT_PERMITTED ? /not allowed/i : /could not be read/i);
  });
  it('does not imply absence in the collapsed shell after a failed read', () => {
    useWorkspace.mockReturnValue({ workspace: null, hasWorkspace: false, loading: false, status: WORKSPACE_READ.NOT_REACHABLE });
    const { getByTitle, queryByTitle } = renderSidebar({ collapsed: true });
    expect(getByTitle('Workspace unavailable')).toBeInTheDocument();
    expect(queryByTitle('No Workspace')).not.toBeInTheDocument();
  });
});

describe('Sidebar — mobile drawer visibility', () => {
  it('closed (mobileMenuOpen=false) → aside is hidden on mobile, never standalone flex', () => {
    const { container } = renderSidebar({ mobileMenuOpen: false });
    const aside = container.querySelector('aside');
    expect(aside).toBeTruthy();
    expect(aside.classList.contains('hidden')).toBe(true);
    // display:flex must NOT win on mobile when closed (the old bug was the reverse)
    expect(aside.classList.contains('flex')).toBe(false);
    // still parked off-screen by the existing transform
    expect(aside.classList.contains('-translate-x-full')).toBe(true);
  });

  it('open (mobileMenuOpen=true) → aside becomes flex (no hidden) and slides in', () => {
    const { container } = renderSidebar({ mobileMenuOpen: true });
    const aside = container.querySelector('aside');
    expect(aside.classList.contains('flex')).toBe(true);
    // the class that defeated the drawer is gone
    expect(aside.classList.contains('hidden')).toBe(false);
    // existing transform brings it on-screen
    expect(aside.classList.contains('translate-x-0')).toBe(true);
  });

  it('desktop is unchanged: aside resolves to flex at lg in BOTH drawer states', () => {
    for (const mobileMenuOpen of [false, true]) {
      const { container, unmount } = renderSidebar({ mobileMenuOpen });
      const aside = container.querySelector('aside');
      // closed → lg:flex reveals it at lg; open → base flex shows it everywhere
      const desktopVisible = aside.classList.contains('lg:flex') || aside.classList.contains('flex');
      expect(desktopVisible).toBe(true);
      unmount();
    }
  });
});

describe('Sidebar — connect-a-channel shortcut (self-hiding)', () => {
  it('no channel connected → shows the highlighted "Connect a channel" entry', () => {
    useConnections.mockReturnValue({ data: { connections: [] }, loading: false, error: null });
    const { getByText } = renderSidebar({ mobileMenuOpen: true });
    expect(getByText('Connect a channel')).toBeTruthy();
  });

  it('a channel is connected → the shortcut disappears (existing users never see it)', () => {
    useConnections.mockReturnValue({ data: { connections: [{ platform: 'META', connected: true }] }, loading: false, error: null });
    const { queryByText } = renderSidebar({ mobileMenuOpen: true });
    expect(queryByText('Connect a channel')).toBeNull();
  });

  it('while connections are still loading → no premature shortcut flash', () => {
    useConnections.mockReturnValue({ data: null, loading: true, error: null });
    const { queryByText } = renderSidebar({ mobileMenuOpen: true });
    expect(queryByText('Connect a channel')).toBeNull();
  });
});

describe('Sidebar — Publishing approval badge', () => {
  it('shows the pending-approval count on the Publishing nav item (operator seat)', () => {
    usePendingApprovals.mockReturnValue({ pending: [{}, {}, {}], loading: false, error: null, refetch: vi.fn() });
    const { getByText } = renderSidebar({ mobileMenuOpen: true });
    const publishingLink = getByText('Publishing').closest('a');
    expect(publishingLink.textContent).toContain('3');
    // and the count came from the artifact-approvals feed with the fetch enabled
    expect(usePendingApprovals).toHaveBeenCalledWith({ enabled: true });
  });

  it('caps the badge at "9+" when more than 9 are pending', () => {
    usePendingApprovals.mockReturnValue({ pending: Array.from({ length: 12 }), loading: false, error: null, refetch: vi.fn() });
    const { getByText } = renderSidebar({ mobileMenuOpen: true });
    const publishingLink = getByText('Publishing').closest('a');
    expect(publishingLink.textContent).toContain('9+');
    expect(publishingLink.textContent).not.toContain('12');
  });

  it('hides the badge when nothing is pending (no empty badge)', () => {
    usePendingApprovals.mockReturnValue({ pending: [], loading: false, error: null, refetch: vi.fn() });
    const { getByText } = renderSidebar({ mobileMenuOpen: true });
    const publishingLink = getByText('Publishing').closest('a');
    // only the label + sub text — no numeric badge
    expect(publishingLink.textContent).toBe('PublishingContent approvals');
  });

  it('suppresses the badge while already on the Publishing page (no stale double-count)', () => {
    usePendingApprovals.mockReturnValue({ pending: [{}, {}, {}], loading: false, error: null, refetch: vi.fn() });
    const { getByText } = renderSidebar({ mobileMenuOpen: true }, { path: '/app/publishing' });
    const publishingLink = getByText('Publishing').closest('a');
    expect(publishingLink.textContent).not.toContain('3');
  });

  it('a CLIENT has no Publishing surface → no item, and the fetch is disabled', () => {
    useCollabRole.mockReturnValue({ role: 'CLIENT' });
    usePendingApprovals.mockReturnValue({ pending: [{}, {}], loading: false, error: null, refetch: vi.fn() });
    const { queryByText } = renderSidebar({ mobileMenuOpen: true });
    expect(queryByText('Publishing')).toBeNull();
    expect(usePendingApprovals).toHaveBeenCalledWith({ enabled: false });
  });
});

describe('Sidebar — plan-based feature gating (locked items hidden)', () => {
  // Locked items are hidden COMPLETELY (not shown with a lock). A visible item is
  // a NavLink (an <a>); an item above the plan is absent from the DOM entirely.
  const isLink = (getByText, label) => getByText(label).closest('a') != null;

  it('PRO: every role-visible item is shown as an interactive link', () => {
    setPlan('PRO');
    const { getByText } = renderSidebar({ mobileMenuOpen: true });
    for (const label of ['Decisions', 'Campaigns', 'Creative Optimizer', 'Reports', 'Intelligence', 'Publishing', 'Testing', 'Measurement']) {
      expect(isLink(getByText, label)).toBe(true);
    }
  });

  it('FREE: the 4 FREE items show; Intelligence/Publishing (GROWTH) + Testing/Measurement (PRO) are hidden', () => {
    setPlan('FREE');
    const { getByText, queryByText } = renderSidebar({ mobileMenuOpen: true });
    // FREE tier — shown as links
    for (const label of ['Decisions', 'Campaigns', 'Creative Optimizer', 'Reports']) {
      expect(isLink(getByText, label)).toBe(true);
    }
    // Above the plan — hidden completely (no label, no lock, no tooltip)
    for (const label of ['Intelligence', 'Publishing', 'Testing', 'Measurement']) {
      expect(queryByText(label)).toBeNull();
    }
    // and no upgrade tooltip is rendered at all
    expect(queryByText(/view plans/i)).toBeNull();
  });

  it('GROWTH: Intelligence/Publishing show; Testing/Measurement (PRO) are hidden', () => {
    setPlan('GROWTH');
    const { getByText, queryByText } = renderSidebar({ mobileMenuOpen: true });
    expect(isLink(getByText, 'Intelligence')).toBe(true);
    expect(isLink(getByText, 'Publishing')).toBe(true);
    expect(queryByText('Testing')).toBeNull();
    expect(queryByText('Measurement')).toBeNull();
  });

  // Phase 5.9 — an entitlement we never READ is not a tier, so the plan filter
  // does not run at all. Hiding would claim the operator is not entitled; the
  // route-level PlanGate still refuses, as an absence rather than an upsell.
  // `canAccess` answers false for EVERY tier here, FREE included, so a filter
  // that ran would empty the navigation entirely rather than trim it.
  it.each([
    ['a failed read', 'NOT_REACHABLE'],
    ['a refused read', 'NOT_PERMITTED'],
    ['an absent workspace', 'NOTHING_FOUND'],
  ])('%s hides NOTHING — including the FREE items', (_label, status) => {
    usePlan.mockReturnValue({ canAccess: () => false, loading: false, status });
    const { getByText } = renderSidebar({ mobileMenuOpen: true });
    for (const label of ['Decisions', 'Campaigns', 'Reports', 'Intelligence', 'Testing']) {
      expect(isLink(getByText, label)).toBe(true);
    }
  });

  it('while the plan is still loading, NOTHING is hidden (no flash for a paying operator)', () => {
    usePlan.mockReturnValue({ canAccess: () => false, loading: true, status: WORKSPACE_READ.LOADING });
    const { getByText } = renderSidebar({ mobileMenuOpen: true });
    // loading guard wins → every role-visible item still renders as a link
    expect(isLink(getByText, 'Testing')).toBe(true);
    expect(isLink(getByText, 'Intelligence')).toBe(true);
  });
});
