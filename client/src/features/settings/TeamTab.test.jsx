// ============================================================
// TeamTab — STRATEGIST gating + self-protection
// ------------------------------------------------------------
// useTeam + useCollabRole + sonner are mocked so we drive the two role states
// directly: a STRATEGIST gets the invite form and per-member controls; everyone
// else gets a read-only roster and the gated message. Your own row never exposes
// a Remove control.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTeam.js', () => ({ useTeam: vi.fn() }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: vi.fn(),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));

import { useTeam } from '@/hooks/useTeam.js';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import TeamTab from './TeamTab.jsx';

const teamState = (over = {}) => ({
  members: [
    { id: 'u-self', email: 'self@ws.com', collabRole: 'STRATEGIST', isSelf: true },
    { id: 'u-b', email: 'buyer@ws.com', collabRole: 'BUYER', isSelf: false },
  ],
  pendingInvitations: [],
  isLoading: false,
  error: null,
  isInviting: false,
  invite: vi.fn(),
  changeRole: vi.fn(),
  removeMember: vi.fn(),
  cancelInvitation: vi.fn(),
  ...over,
});

describe('TeamTab', () => {
  it('STRATEGIST sees the invite form + a Remove control on other members (not self)', () => {
    useCollabRole.mockReturnValue({ role: 'STRATEGIST' });
    useTeam.mockReturnValue(teamState());
    render(<TeamTab />);
    expect(screen.getByPlaceholderText(/teammate@company.com/i)).toBeInTheDocument();
    expect(screen.getByText(/\(you\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Remove buyer@ws.com/i)).toBeInTheDocument();
    // never a control for your own row
    expect(screen.queryByLabelText(/Remove self@ws.com/i)).not.toBeInTheDocument();
  });

  it('non-STRATEGIST gets a read-only roster + the gated invite message', () => {
    useCollabRole.mockReturnValue({ role: 'BUYER' });
    useTeam.mockReturnValue(teamState());
    render(<TeamTab />);
    expect(screen.queryByPlaceholderText(/teammate@company.com/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Only Strategists can invite team members/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Remove buyer@ws.com/i)).not.toBeInTheDocument();
  });
});
