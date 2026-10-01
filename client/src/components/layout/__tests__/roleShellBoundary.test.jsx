// ============================================================
// The shell holds until the seat is known (Phase 5.11)
// ------------------------------------------------------------
// The approved ruling — "do not expose operator-level navigation or controls
// while role resolution is pending" — is enforced in ONE place, and this is it.
//
// It is a shell gate rather than nineteen consumer gates because of a measured
// property of the consumers: eight of them decide operator-vs-client by testing
// `role === CLIENT`, so a null role falls into the OPERATOR branch in every
// one. Gating them individually would have been a fail-open wearing a fix. The
// case below is therefore about the SIDEBAR as much as the page: on an
// unresolved seat neither may render.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useCollabRole.js', async (io) => ({ ...(await io()), useCollabRole: vi.fn() }));
vi.mock('@/features/shell', () => ({ useRecentDecisions: () => ({ data: [] }) }));
vi.mock('../Sidebar.jsx', () => ({ default: () => <nav>operator sidebar</nav> }));
vi.mock('@/components/brand/LumiStar.jsx', () => ({ default: () => null }));
vi.mock('@/router/ProtectedRoute.jsx', () => ({
  FullscreenLoader: ({ label }) => <div>{label ?? 'loading'}</div>,
}));

import MainLayout from '../MainLayout.jsx';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { ROLE_READ } from '@/context/RoleContext.jsx';

// RoleProvider wraps the shell and would fetch; the seat is injected at the
// hook the shell actually reads, so no network is involved.
const seat = (status, role = null) => useCollabRole.mockReturnValue({ role, status, loading: status === ROLE_READ.LOADING });

const renderShell = () => render(<MemoryRouter><MainLayout /></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

describe('MainLayout — the role boundary', () => {
  it('a RESOLVED seat renders the shell, exactly as before', () => {
    seat(ROLE_READ.PRESENT, 'STRATEGIST');
    renderShell();
    expect(screen.getByText('operator sidebar')).toBeInTheDocument();
    expect(document.querySelector('#main-content')).toBeTruthy();
    expect(screen.queryByText('Context: Locked')).not.toBeInTheDocument();
    expect(screen.queryByText('Dual-Agent Ready')).not.toBeInTheDocument();
    expect(screen.queryByText(/SID _NSD87T/)).not.toBeInTheDocument();
  });

  it('a LOADING seat renders no sidebar and no main region — only a wait', () => {
    seat(ROLE_READ.LOADING);
    renderShell();
    expect(screen.queryByText('operator sidebar')).not.toBeInTheDocument();
    expect(document.querySelector('#main-content')).toBeNull();
    expect(screen.getByText(/checking your access/i)).toBeInTheDocument();
  });

  it.each([
    ['a failed read', ROLE_READ.NOT_REACHABLE],
    ['a refused read', ROLE_READ.NOT_PERMITTED],
    ['an unreadable answer', ROLE_READ.NOTHING_FOUND],
  ])('%s renders no operator navigation at all', (_label, status) => {
    seat(status);
    renderShell();
    expect(screen.queryByText('operator sidebar')).not.toBeInTheDocument();
    expect(document.querySelector('#main-content')).toBeNull();
  });

  it('a failed read says what happened rather than showing a half shell', () => {
    seat(ROLE_READ.NOT_REACHABLE);
    renderShell();
    expect(screen.getByText(/Lumi couldn’t check your access just now/i)).toBeInTheDocument();
  });

  it('REGRESSION: a null role does not read as an operator seat', () => {
    // The precise shape of the old defect: role null, status not PRESENT. Every
    // `role === CLIENT` consumer would take the operator branch if this rendered.
    seat(ROLE_READ.NOT_REACHABLE, null);
    renderShell();
    expect(screen.queryByText('operator sidebar')).not.toBeInTheDocument();
  });
});
