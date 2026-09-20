// ============================================================
// TeamTab — STRATEGIST gating + self-protection
// ------------------------------------------------------------
// useTeam + useCollabRole + sonner are mocked so we drive the role states
// directly: a STRATEGIST gets the invite form and per-member controls, and your
// own row never exposes a Remove control.
//
// Phase 5.12 — the non-STRATEGIST case below is now about THIS COMPONENT, not
// about what a BUYER sees in the product. R-15 moved the section audience to
// the route manifest, and SettingsView refuses to mount this tab for a seat
// that is not a STRATEGIST, so a BUYER no longer reaches the roster through
// Settings (see settingsAudience.test.jsx, which asserts that).
//
// The assertion is kept rather than deleted because it is still TRUE of the
// component and it is the second layer: if this tab is ever mounted from
// somewhere that does not gate it, the mutation controls must still be absent.
// Deleting it would delete the only thing standing between a future caller and
// an invite form for a BUYER.
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

  it('mounted directly for a non-STRATEGIST: no mutation controls, gated invite message (defence in depth — Settings no longer mounts it for this seat)', () => {
    useCollabRole.mockReturnValue({ role: 'BUYER' });
    useTeam.mockReturnValue(teamState());
    render(<TeamTab />);
    expect(screen.queryByPlaceholderText(/teammate@company.com/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Only Strategists can invite team members/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Remove buyer@ws.com/i)).not.toBeInTheDocument();
  });
});
