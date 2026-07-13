// ============================================================
// SecurityTab — context-aware account-deletion warning
// ------------------------------------------------------------
// The delete warning must mirror the backend guard (routes/user.js) BEFORE the
// user commits — so they know whether they're destroying the whole workspace,
// blocked as the last strategist, or just removing their own membership.
// Effective role: null collabRole ⇒ STRATEGIST.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('@/hooks/useFocusTrap.js', () => ({ useFocusTrap: () => ({ current: null }) }));
vi.mock('@/hooks/useTeam.js', () => ({ useTeam: vi.fn(() => ({ members: [] })) }));

import { SecurityTab } from './SecurityTab.jsx';
import { useTeam } from '@/hooks/useTeam.js';

const baseProps = {
  currentUser: { email: 'me@ws.com', metadata: { lastSignInTime: null } },
  handlePasswordReset: vi.fn(),
  handleResetSetup: vi.fn(),
  busy: false,
  showDeleteModal: false,
  setShowDeleteModal: vi.fn(),
  deleteConfirmText: '',
  setDeleteConfirmText: vi.fn(),
  handleDeleteAccount: vi.fn(),
  formatDate: () => '—',
};

function renderTab() {
  return render(<MemoryRouter><SecurityTab {...baseProps} /></MemoryRouter>);
}

describe('SecurityTab — deletion warning is context-aware', () => {
  it('sole member → warns the entire workspace will be deleted', () => {
    useTeam.mockReturnValue({ members: [{ id: '1', email: 'me@ws.com', isSelf: true, collabRole: 'STRATEGIST' }] });
    renderTab();
    expect(screen.getByText(/only member/i)).toBeInTheDocument();
    expect(screen.getByText(/entire workspace/i)).toBeInTheDocument();
  });

  it('last strategist (other members exist) → tells them to transfer the role first', () => {
    useTeam.mockReturnValue({ members: [
      { id: '1', email: 'me@ws.com', isSelf: true, collabRole: 'STRATEGIST' },
      { id: '2', email: 'buyer@ws.com', isSelf: false, collabRole: 'BUYER' },
    ] });
    renderTab();
    expect(screen.getByText(/last Strategist/i)).toBeInTheDocument();
    expect(screen.getByText(/transfer the Strategist role/i)).toBeInTheDocument();
  });

  it('non-last member → only their membership is removed; workspace untouched', () => {
    useTeam.mockReturnValue({ members: [
      { id: '1', email: 'me@ws.com', isSelf: true, collabRole: 'BUYER' },
      { id: '2', email: 'boss@ws.com', isSelf: false, collabRole: 'STRATEGIST' },
    ] });
    renderTab();
    expect(screen.getByText(/removed from this workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/other members are not affected/i)).toBeInTheDocument();
  });
});
