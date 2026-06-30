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
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext.jsx', () => ({
  useAuth: () => ({ currentUser: { email: 'op@ws.com', displayName: 'Op' } }),
}));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'STRATEGIST' }),
}));
vi.mock('@/hooks/useWorkspace.js', () => ({
  useWorkspace: () => ({ workspace: { name: 'Acme', market: 'EG' }, hasWorkspace: true, loading: false }),
}));
vi.mock('@/components/ui/NotificationBell.jsx', () => ({ default: () => null }));
vi.mock('@/features/inbox/InboxPanel.jsx', () => ({ default: () => null }));
vi.mock('@/components/ui/RecentDecisions.jsx', () => ({ default: () => null }));
vi.mock('@/components/ui/CommandPalette.jsx', () => ({ default: () => null }));
vi.mock('./RadarStrip.jsx', () => ({ default: () => null }));
vi.mock('@/components/brand/LumiStar.jsx', () => ({ default: () => null }));

import Sidebar from './Sidebar.jsx';

function renderSidebar(props = {}) {
  return render(
    <MemoryRouter>
      <Sidebar collapsed={false} onToggle={() => {}} onMobileMenuToggle={() => {}} {...props} />
    </MemoryRouter>,
  );
}

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
