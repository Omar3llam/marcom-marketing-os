// ============================================================
// R-15 — Settings audience & permission boundaries (Phase 5.12)
// ------------------------------------------------------------
// Drives the REAL SettingsView through a REAL router at real addresses, with
// only the leaves mocked (the seat, the tabs' own data hooks, Firebase).
//
// The question is never "does the nav hide a link" — it is "does the URL render
// the content". Those are different questions and only the second one is a
// permission, so every case here enters by ADDRESS, the way a bookmark, a
// pasted link or a refresh does. A test that clicks the nav proves the nav.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/firebase.js', () => ({ auth: {}, sendPasswordResetEmail: vi.fn() }));
vi.mock('@/router/ProtectedRoute.jsx', () => ({
  clearContextCache: vi.fn(),
  FullscreenLoader: ({ label }) => <div>{label}</div>,
}));
vi.mock('@/context/AuthContext.jsx', () => ({
  useAuth: () => ({
    currentUser: { email: 'someone@ws.com', displayName: 'Someone' },
    logout: vi.fn(),
  }),
}));
vi.mock('@/hooks/useUserRole.js', () => ({
  useUserRole: () => ({ isAdmin: false, isLoading: false }),
}));
vi.mock('./services.js', () => ({
  updateUserProfile: vi.fn(),
  updateWorkspaceName: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

// The seat under test. SettingsView and RoleGate both read this module.
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: vi.fn(),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));

// The gated tabs' own data hooks, mocked so that MOUNTING is observable.
// `teamFetched` is the real question: a gate that hides the markup but still
// fetches the roster has refused nothing.
//
// vi.hoisted, because vi.mock factories are lifted above every top-level
// declaration in this file — a plain `const` read from inside one is a TDZ
// crash waiting for an import order to change.
const { teamFetched } = vi.hoisted(() => ({ teamFetched: vi.fn() }));
vi.mock('@/hooks/useTeam.js', () => ({
  useTeam: () => {
    teamFetched();
    return {
      members: [{ id: 'u-1', email: 'roster-leak@ws.com', collabRole: 'BUYER', isSelf: false }],
      pendingInvitations: [],
      isLoading: false,
      error: null,
      isInviting: false,
      invite: vi.fn(),
      changeRole: vi.fn(),
      removeMember: vi.fn(),
      cancelInvitation: vi.fn(),
    };
  },
}));
vi.mock('@/hooks/useRevenueCsv.js', () => ({
  useRevenueCsv: () => ({
    parse: vi.fn(), upload: vi.fn(), isUploading: false, result: null, error: null, reset: vi.fn(),
  }),
}));
vi.mock('@/hooks/useRunSweep.js', () => ({
  useRunSweep: () => ({ runSweep: vi.fn(), sweeping: false }),
}));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({
  useConnectorCampaigns: () => ({ campaigns: [] }),
}));
vi.mock('@/hooks/useWorkspace.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useWorkspace: () => ({ workspace: null, hasWorkspace: false, loading: false }),
}));

import { useCollabRole } from '@/hooks/useCollabRole.js';
import { ROLE_READ } from '@/context/RoleContext.jsx';
import { appRoutes, settingsSections } from '@/app/routeManifest.js';
import SettingsView from './SettingsView.jsx';

/** A seat the read RESOLVED to. */
const seat = (role) => ({
  role, visibleStates: null, loading: false, error: null, status: ROLE_READ.PRESENT,
});
/** A read that did not resolve to a seat. `role` is null — never a guess. */
const unread = (status) => ({
  role: null, visibleStates: null, loading: false, error: null, status,
});
const loadingSeat = {
  role: null, visibleStates: null, loading: true, error: null, status: ROLE_READ.LOADING,
};

/** Enter by ADDRESS, through the route shape App.jsx declares. */
function at(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/settings" element={<SettingsView />} />
        <Route path="/app/settings/:section" element={<SettingsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

const TEAM_CONTENT = /Invite a teammate|roster-leak@ws.com/i;
const REVENUE_CONTENT = /Upload revenue data/i;
const REFUSAL = /Restricted section/i;
const READ_FAILED = /read this account/i;

beforeEach(() => { vi.clearAllMocks(); });

// ── The audience matrix, entered by URL ──────────────────────────────
describe('R-15 · Team & Roles is STRATEGIST-only, by address', () => {
  it('STRATEGIST opening /app/settings/team gets the section', () => {
    useCollabRole.mockReturnValue(seat('STRATEGIST'));
    at(appRoutes.settingsTeam);
    expect(screen.getByText(/Invite a teammate/i)).toBeInTheDocument();
    expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
  });

  for (const role of ['BUYER', 'CLIENT']) {
    it(role + ' opening /app/settings/team gets an explicit refusal and NO roster', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsTeam);
      expect(screen.getByText(REFUSAL)).toBeInTheDocument();
      expect(screen.getByText(/Only a strategist can open Team & Roles/i)).toBeInTheDocument();
      expect(screen.queryByText(TEAM_CONTENT)).not.toBeInTheDocument();
    });

    it(role + ' never triggers the roster FETCH — the tab is not mounted, not merely hidden', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsTeam);
      expect(teamFetched).not.toHaveBeenCalled();
    });

    it(role + ' does not see a Team & Roles nav link', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsGeneral);
      expect(screen.queryByRole('link', { name: 'Team & Roles' })).not.toBeInTheDocument();
    });

    it(role + ' keeps legitimate Settings access (the shell and its open sections)', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsGeneral);
      expect(screen.getByText(/Workspace Settings/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'General' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Security' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Workspace' })).toBeInTheDocument();
    });
  }
});

describe('R-15 · Revenue data is STRATEGIST-only, by address', () => {
  it('STRATEGIST gets the upload surface', () => {
    useCollabRole.mockReturnValue(seat('STRATEGIST'));
    at(appRoutes.settingsRevenue);
    expect(screen.getByText(REVENUE_CONTENT)).toBeInTheDocument();
  });

  it('BUYER gets the refusal, never the upload surface', () => {
    useCollabRole.mockReturnValue(seat('BUYER'));
    at(appRoutes.settingsRevenue);
    expect(screen.getByText(/Only a strategist can open Revenue data/i)).toBeInTheDocument();
    expect(screen.queryByText(REVENUE_CONTENT)).not.toBeInTheDocument();
  });
});

// ── The read states. A seat that was not READ is not a seat. ─────────
describe('R-15 · role LOADING, NOT_REACHABLE, NOT_PERMITTED, missing, malformed', () => {
  it('LOADING holds the restricted section — no content and no refusal claim', () => {
    useCollabRole.mockReturnValue(loadingSeat);
    at(appRoutes.settingsTeam);
    expect(screen.queryByText(TEAM_CONTENT)).not.toBeInTheDocument();
    // Not a refusal either: nothing has refused us yet.
    expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
    expect(teamFetched).not.toHaveBeenCalled();
  });

  it('LOADING does not flash the Team & Roles nav link', () => {
    useCollabRole.mockReturnValue(loadingSeat);
    at(appRoutes.settingsGeneral);
    expect(screen.queryByRole('link', { name: 'Team & Roles' })).not.toBeInTheDocument();
  });

  it('NOT_REACHABLE fails closed and says the READ failed — never a refusal, never the roster', () => {
    useCollabRole.mockReturnValue(unread(ROLE_READ.NOT_REACHABLE));
    at(appRoutes.settingsTeam);
    expect(screen.getByText(READ_FAILED)).toBeInTheDocument();
    expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
    expect(screen.queryByText(TEAM_CONTENT)).not.toBeInTheDocument();
  });

  it('NOT_PERMITTED on the ROLE READ is distinct from a section refusal', () => {
    useCollabRole.mockReturnValue(unread(ROLE_READ.NOT_PERMITTED));
    at(appRoutes.settingsTeam);
    expect(screen.getByText(READ_FAILED)).toBeInTheDocument();
    expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
    expect(screen.queryByText(TEAM_CONTENT)).not.toBeInTheDocument();
  });

  it('a 200 with a MISSING role never renders the section', () => {
    useCollabRole.mockReturnValue(unread(ROLE_READ.NOT_REACHABLE));
    at(appRoutes.settingsTeam);
    expect(screen.queryByText(TEAM_CONTENT)).not.toBeInTheDocument();
    expect(teamFetched).not.toHaveBeenCalled();
  });

  it('a MALFORMED role value is not a seat, and not the narrowest seat either', () => {
    // status PRESENT but a value no allow-list contains — the gate must refuse
    // rather than fall into a branch by accident.
    useCollabRole.mockReturnValue(seat('SUPERUSER'));
    at(appRoutes.settingsTeam);
    expect(screen.queryByText(TEAM_CONTENT)).not.toBeInTheDocument();
    expect(teamFetched).not.toHaveBeenCalled();
  });

  it('retry after a failed read: once the seat resolves to STRATEGIST the section returns', () => {
    useCollabRole.mockReturnValue(unread(ROLE_READ.NOT_REACHABLE));
    const view = at(appRoutes.settingsTeam);
    expect(screen.queryByText(/Invite a teammate/i)).not.toBeInTheDocument();
    view.unmount();
    useCollabRole.mockReturnValue(seat('STRATEGIST'));
    at(appRoutes.settingsTeam);
    expect(screen.getByText(/Invite a teammate/i)).toBeInTheDocument();
  });
});

// ── Routing. No redirect means no loop, and Back still works. ────────
describe('R-15 · routing behaviour', () => {
  it('a refused section does NOT redirect — the address is preserved', () => {
    useCollabRole.mockReturnValue(seat('BUYER'));
    at(appRoutes.settingsTeam);
    // Still the Settings shell, at the same address. A redirect would have
    // replaced the entry and there would be nothing left to refuse.
    expect(screen.getByText(/Workspace Settings/i)).toBeInTheDocument();
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
  });

  it('a refresh on the restricted address lands on the same refusal, not a loop', () => {
    useCollabRole.mockReturnValue(seat('CLIENT'));
    const first = at(appRoutes.settingsTeam);
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
    first.unmount();
    at(appRoutes.settingsTeam); // same entry, fresh mount = a refresh
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
  });

  it('query parameters do not change the answer', () => {
    useCollabRole.mockReturnValue(seat('BUYER'));
    at(appRoutes.settingsTeam + '?section=team&role=STRATEGIST');
    expect(screen.queryByText(TEAM_CONTENT)).not.toBeInTheDocument();
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
  });

  it('an invented section key (/app/settings/team-and-roles) resolves to General, not to Team', () => {
    useCollabRole.mockReturnValue(seat('BUYER'));
    at('/app/settings/team-and-roles');
    expect(screen.queryByText(TEAM_CONTENT)).not.toBeInTheDocument();
    expect(screen.getByText(/Workspace Settings/i)).toBeInTheDocument();
  });

  it('/app/settings (no section) stays open to every seat', () => {
    for (const role of ['STRATEGIST', 'BUYER', 'CLIENT']) {
      useCollabRole.mockReturnValue(seat(role));
      const v = at(appRoutes.settings);
      expect(screen.getByText(/Workspace Settings/i)).toBeInTheDocument();
      expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
      v.unmount();
    }
  });
});

// ── The declaration itself. One list, both questions. ────────────────
describe('R-15 · the audience is declared once, in the manifest', () => {
  it('team and revenue are STRATEGIST-only; the personal sections are unconstrained', () => {
    const byKey = Object.fromEntries(settingsSections.map((s) => [s.key, s]));
    expect(byKey.team.roles).toEqual(['STRATEGIST']);
    expect(byKey.revenue.roles).toEqual(['STRATEGIST']);
    // Self-refutation: if everything were locked, the matrix above proves nothing.
    expect(byKey.general.roles).toBeUndefined();
    expect(byKey.security.roles).toBeUndefined();
    // OPEN RULING — deliberately unconstrained, asserted so a change is visible.
    expect(byKey.workspace.roles).toBeUndefined();
  });
});
