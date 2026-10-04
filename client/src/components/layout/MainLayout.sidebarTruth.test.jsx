import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/context/AuthContext.jsx', () => ({
  useAuth: () => ({ currentUser: { email: 'op@ws.com', displayName: 'Op' } }),
}));
vi.mock('@/context/RoleContext.jsx', async (original) => ({
  ...(await original()), RoleProvider: ({ children }) => children,
}));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: vi.fn(() => ({ role: 'STRATEGIST', status: 'PRESENT', loading: false, error: null })),
}));
vi.mock('@/hooks/useWorkspace.js', async (original) => ({
  ...(await original()),
  useWorkspace: () => ({ workspace: { name: 'Acme', market: 'EG' }, hasWorkspace: true, loading: false, status: 'PRESENT' }),
}));
vi.mock('@/hooks/usePlan.js', async (original) => ({
  ...(await original()), usePlan: () => ({ canAccess: () => true, loading: false, status: 'PRESENT' }),
}));
vi.mock('@/hooks/useConnections.js', () => ({
  useConnections: () => ({ data: { connections: [] }, loading: false }),
}));
vi.mock('@/hooks/usePendingApprovals.js', () => ({
  usePendingApprovals: vi.fn(() => ({ pending: [], loading: false, error: null })),
}));
vi.mock('@/features/shell', () => ({ useRecentDecisions: () => ({ data: [] }) }));
vi.mock('@/hooks/useInbox.js', () => ({
  useInbox: vi.fn(() => ({ items: [], status: 'NOTHING_FOUND', reason: null, error: null })),
}));
vi.mock('@/components/ui/RecentDecisions.jsx', () => ({ default: () => null }));
vi.mock('@/components/ui/CommandPalette.jsx', () => ({ default: () => null }));

// Keep the real layout, Sidebar, NotificationBell, InboxPanel, and RadarStrip
// (before its removal). Only their source hooks and unrelated heavy children are stubbed.
import MainLayout from './MainLayout.jsx';
import { usePendingApprovals } from '@/hooks/usePendingApprovals.js';
import { useInbox } from '@/hooks/useInbox.js';

function show(path = '/app/overview') {
  return render(<MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/app" element={<MainLayout />}>
        <Route path="overview" element={<p>Overview content</p>} />
        <Route path="leadership" element={<p>Reports content</p>} />
        <Route path="publishing" element={<p>Publishing content</p>} />
      </Route>
    </Routes>
  </MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingApprovals.mockReturnValue({ pending: [], loading: false, error: null });
  useInbox.mockReturnValue({ items: [], status: 'NOTHING_FOUND', reason: null, error: null });
});

describe('MainLayout — Sidebar evidence boundaries', () => {
  it('does not publish unsupported monitoring or replacement reassurance under live default inputs', () => {
    const { container } = show();
    const sidebar = within(container.querySelector('aside'));
    expect(sidebar.queryAllByText(/^(Monitoring|Watching|Radar|Alerts active)$/i)).toHaveLength(0);
    expect(sidebar.queryByText(/0 alerts|No alerts|Everything clear|All systems normal/i)).not.toBeInTheDocument();
    expect(container.querySelector('aside .lucide-radar')).not.toBeInTheDocument();
    expect(container.querySelector('aside [style*="pulse"]')).not.toBeInTheDocument();
  });

  it('keeps the real bell neutral and mounts its live Inbox reader only on open', () => {
    show();
    const bell = screen.getByRole('button', { name: 'Notifications' });
    expect(bell).not.toHaveClass('text-signal-kill');
    expect(bell.querySelector('[style*="pulse"]')).not.toBeInTheDocument();
    expect(useInbox).not.toHaveBeenCalled();
    fireEvent.click(bell);
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('No items to show right now.')).toBeInTheDocument();
    expect(useInbox).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
  });

  it('retains Inbox selection navigation and drawer closing', () => {
    useInbox.mockReturnValue({ items: [{
      type: 'narrative', id: 'n1', title: 'Read weekly report', to: '/app/leadership',
    }], status: 'PRESENT', reason: null, error: null });
    const { container } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read weekly report' }));
    expect(screen.getByText('Reports content')).toBeInTheDocument();
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
    expect(container.querySelector('aside')).toHaveClass('hidden', '-translate-x-full');
  });

  it.each([
    [3, '/app/overview', '3'], [0, '/app/overview', ''], [3, '/app/publishing', ''],
  ])('preserves Publishing evidence: %s pending on %s', (count, path, badge) => {
    usePendingApprovals.mockReturnValue({ pending: Array.from({ length: count }, () => ({})), loading: false, error: null });
    const { container } = show(path);
    const sidebar = within(container.querySelector('aside'));
    expect(sidebar.getByRole('link', { name: /Publishing/ }).textContent).toBe('PublishingContent approvals' + badge);
    expect(sidebar.getByRole('link', { name: /Attention/ }).textContent).toBe('AttentionWhat needs you now');
  });

  it('preserves desktop collapse, drawer visibility, scroll region and footer structure', () => {
    const { container } = show();
    const aside = container.querySelector('aside');
    expect(aside).toHaveClass('hidden', 'lg:flex', 'lg:w-[268px]');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(aside).toHaveClass('flex', 'translate-x-0');
    expect(aside).not.toHaveClass('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(aside).toHaveClass('hidden', '-translate-x-full');
    fireEvent.click(within(aside).getByRole('button', { name: /Lumi/i }));
    expect(aside).toHaveClass('lg:w-[64px]');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    const scroll = aside.querySelector('.overflow-y-auto');
    expect(scroll).toHaveClass('flex-1');
    expect(scroll.nextElementSibling).toBe(aside.lastElementChild);
    expect(aside.lastElementChild).toHaveClass('flex-shrink-0');
    expect(within(aside.lastElementChild).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(scroll.nextElementSibling).toBe(aside.lastElementChild);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('STRATEGIST · EG')).toBeInTheDocument();
  });
});
