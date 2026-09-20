// ============================================================
// TeamTab — STRATEGIST-only MUTATIONS + self-protection
// ------------------------------------------------------------
// useTeam + useCollabRole + sonner are mocked so we drive the role states
// directly: a STRATEGIST gets the invite form and per-member controls; every
// other member gets the read-only roster, which is what the API grants them
// (GET /api/team/members is open to any member). Your own row never exposes a
// Remove control.
//
// Phase 5.12 (R-15) — the audience split is asserted from the manifest side in
// settingsAudience.test.jsx. What belongs HERE is the manage axis: that the
// controls follow `manageAudience`, and that a seat we could not READ gets the
// roster without them rather than falling into the operator branch.
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
    // The roster itself is NOT withheld — the API grants this read to every
    // member, and a surface that hid it would be claiming a rule that does not
    // exist. Only the controls are gated.
    expect(screen.getByText('buyer@ws.com')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/teammate@company.com/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Only Strategists can invite team members/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Remove buyer@ws.com/i)).not.toBeInTheDocument();
  });

  // Phase 5.12 — the manage axis must FAIL CLOSED on a seat that was not read.
  // Since 5.11 that seat is `role: null`, and `null === 'STRATEGIST'` is false,
  // so the old literal comparison already refused — but the equality direction
  // is exactly what sent a null role into the OPERATOR branch in eight other
  // consumers (5.11). Asserting it here means a future refactor cannot quietly
  // flip it without a test going red.
  it('an UNREAD seat (role null) gets the roster but never the controls', () => {
    useCollabRole.mockReturnValue({ role: null });
    useTeam.mockReturnValue(teamState());
    render(<TeamTab />);
    expect(screen.getByText('buyer@ws.com')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/teammate@company.com/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Remove buyer@ws.com/i)).not.toBeInTheDocument();
  });

  it('a MALFORMED role is not the operator branch either', () => {
    useCollabRole.mockReturnValue({ role: 'SUPERUSER' });
    useTeam.mockReturnValue(teamState());
    render(<TeamTab />);
    expect(screen.queryByPlaceholderText(/teammate@company.com/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Remove buyer@ws.com/i)).not.toBeInTheDocument();
  });
});
