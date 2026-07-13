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
vi.mock('@/hooks/useWorkspace.js', () => ({
  useWorkspace: () => ({ workspace: { name: 'Acme', market: 'EG' }, hasWorkspace: true, loading: false }),
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
  useCollabRole.mockReturnValue({ role: 'STRATEGIST' });
  useConnections.mockReturnValue({ data: null, loading: false, error: null });
  usePendingApprovals.mockReturnValue({ pending: [], loading: false, error: null, refetch: vi.fn() });
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
    expect(publishingLink.textContent).toBe('PublishingRecord live ad publishes');
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
