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
//
// TWO AXES, asserted separately and asserted to DISAGREE where the backend
// disagrees. `viewAudience` decides whether the door opens; `manageAudience`
// decides whether the controls inside it work. Team & Roles is the case that
// proves they are not the same field: every member may read the roster (the API
// grants it), and only a STRATEGIST may change it.
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

// The seat under test. SettingsView, RoleGate and TeamTab all read this module.
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: vi.fn(),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));

// The tabs' own data hooks, mocked so that MOUNTING is observable.
// `teamFetched` is the real question for a VIEW gate: a gate that hides the
// markup but still fetches has refused nothing.
//
// vi.hoisted, because vi.mock factories are lifted above every top-level
// declaration in this file — a plain `const` read from inside one is a TDZ
// crash waiting for an import order to change.
const { teamFetched } = vi.hoisted(() => ({ teamFetched: vi.fn() }));
vi.mock('@/hooks/useTeam.js', () => ({
  useTeam: () => {
    teamFetched();
    return {
      members: [
        { id: 'u-1', email: 'self@ws.com', collabRole: 'STRATEGIST', isSelf: true },
        { id: 'u-2', email: 'teammate@ws.com', collabRole: 'BUYER', isSelf: false },
      ],
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
// `revenueMounted` is the instrument for the VIEW gate on a restricted section.
// Asserting that the content is absent is not enough: RevenueCsvTab carries its
// own fail-closed guard, so it renders a refusal rather than the upload form
// even when the door gate wrongly lets it through. Absent content would look
// identical in both cases. Counting the MOUNT distinguishes "the gate held" from
// "the gate opened and the tab refused on its own" — which is precisely the
// difference a defence-in-depth guard is able to hide.
const { revenueMounted } = vi.hoisted(() => ({ revenueMounted: vi.fn() }));
vi.mock('@/hooks/useRevenueCsv.js', () => ({
  useRevenueCsv: () => {
    revenueMounted();
    return {
      parse: vi.fn(), upload: vi.fn(), isUploading: false, result: null, error: null, reset: vi.fn(),
    };
  },
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
import { appRoutes, settingsSections, settingsSection } from '@/app/routeManifest.js';
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

const ROSTER = /teammate@ws\.com/i;
const INVITE_FORM = /teammate@company\.com/i;          // the placeholder — a MUTATION control
const INVITE_REFUSED = /Only Strategists can invite team members/i;
const REVENUE_CONTENT = /Upload revenue data/i;
const REFUSAL = /Restricted section/i;
const READ_FAILED = /read this account/i;

beforeEach(() => { vi.clearAllMocks(); });

// ── The axis that matters: view ≠ manage ─────────────────────────────
describe('R-15 · Team & Roles — readable by every member, manageable by a STRATEGIST', () => {
  it('STRATEGIST opening /app/settings/team gets the roster AND the controls', () => {
    useCollabRole.mockReturnValue(seat('STRATEGIST'));
    at(appRoutes.settingsTeam);
    expect(screen.getByText(ROSTER)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(INVITE_FORM)).toBeInTheDocument();
    expect(screen.getByLabelText(/Remove teammate@ws\.com/i)).toBeInTheDocument();
  });

  for (const role of ['BUYER', 'CLIENT']) {
    it(role + ' opening /app/settings/team gets the roster — the API grants this read', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsTeam);
      expect(screen.getByText(ROSTER)).toBeInTheDocument();
      expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
      expect(teamFetched).toHaveBeenCalled();
    });

    it(role + ' gets NO mutation controls and an explicit reason', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsTeam);
      expect(screen.queryByPlaceholderText(INVITE_FORM)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Remove teammate@ws\.com/i)).not.toBeInTheDocument();
      expect(screen.getByText(INVITE_REFUSED)).toBeInTheDocument();
    });

    it(role + ' still sees the Team & Roles nav link — manage rights never hide a link', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsGeneral);
      expect(screen.getByRole('link', { name: 'Team & Roles' })).toBeInTheDocument();
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

// ── A genuinely restricted section still refuses at the door ─────────
describe('R-15 · Revenue data — restricted on BOTH axes, by address', () => {
  it('STRATEGIST gets the upload surface', () => {
    useCollabRole.mockReturnValue(seat('STRATEGIST'));
    at(appRoutes.settingsRevenue);
    expect(screen.getByText(REVENUE_CONTENT)).toBeInTheDocument();
    // Self-refutation for the mount instrument: if it never fired for ANYONE,
    // every "not mounted" assertion above would be vacuously true.
    expect(revenueMounted).toHaveBeenCalled();
  });

  for (const role of ['BUYER', 'CLIENT']) {
    it(role + ' gets the refusal, and the tab is never mounted', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsRevenue);
      expect(screen.getByText(/Only a strategist can open Revenue data/i)).toBeInTheDocument();
      expect(screen.queryByText(REVENUE_CONTENT)).not.toBeInTheDocument();
      expect(revenueMounted).not.toHaveBeenCalled();
    });

    it(role + ' does not see a Revenue data nav link', () => {
      useCollabRole.mockReturnValue(seat(role));
      at(appRoutes.settingsGeneral);
      expect(screen.queryByRole('link', { name: 'Revenue data' })).not.toBeInTheDocument();
    });
  }
});

// ── The read states. A seat that was not READ is not a seat. ─────────
describe('R-15 · role LOADING, NOT_REACHABLE, NOT_PERMITTED, missing, malformed', () => {
  it('an UNREAD seat gets the Team roster but never the controls — fail closed on MANAGE', () => {
    useCollabRole.mockReturnValue(seat(null));
    at(appRoutes.settingsTeam);
    expect(screen.getByText(ROSTER)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(INVITE_FORM)).not.toBeInTheDocument();
    expect(screen.getByText(INVITE_REFUSED)).toBeInTheDocument();
  });

  it('a MALFORMED role never reaches the operator branch', () => {
    useCollabRole.mockReturnValue(seat('SUPERUSER'));
    at(appRoutes.settingsTeam);
    expect(screen.queryByPlaceholderText(INVITE_FORM)).not.toBeInTheDocument();
    expect(screen.getByText(INVITE_REFUSED)).toBeInTheDocument();
  });

  it('LOADING holds the RESTRICTED section — the tab is NOT MOUNTED, and no refusal is claimed', () => {
    useCollabRole.mockReturnValue(loadingSeat);
    at(appRoutes.settingsRevenue);
    // The gate held: the component never ran. Asserting only on absent content
    // would pass even if the gate opened, because the tab refuses on its own.
    expect(revenueMounted).not.toHaveBeenCalled();
    expect(screen.queryByText(REVENUE_CONTENT)).not.toBeInTheDocument();
    // Not a refusal either: nothing has refused us yet.
    expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
  });

  it('LOADING does not flash the Revenue data nav link', () => {
    useCollabRole.mockReturnValue(loadingSeat);
    at(appRoutes.settingsGeneral);
    expect(screen.queryByRole('link', { name: 'Revenue data' })).not.toBeInTheDocument();
  });

  it('LOADING withholds the Team MUTATION controls, though the section is open', () => {
    useCollabRole.mockReturnValue(loadingSeat);
    at(appRoutes.settingsTeam);
    expect(screen.queryByPlaceholderText(INVITE_FORM)).not.toBeInTheDocument();
  });

  for (const status of ['NOT_REACHABLE', 'NOT_PERMITTED']) {
    it(status + ' on a restricted section fails closed and says the READ failed, not that we were refused', () => {
      useCollabRole.mockReturnValue(unread(ROLE_READ[status]));
      at(appRoutes.settingsRevenue);
      expect(screen.getByText(READ_FAILED)).toBeInTheDocument();
      expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
      expect(screen.queryByText(REVENUE_CONTENT)).not.toBeInTheDocument();
      expect(revenueMounted).not.toHaveBeenCalled();
    });

    it(status + ' never exposes Team mutation controls', () => {
      useCollabRole.mockReturnValue(unread(ROLE_READ[status]));
      at(appRoutes.settingsTeam);
      expect(screen.queryByPlaceholderText(INVITE_FORM)).not.toBeInTheDocument();
    });
  }

  it('retry after a failed read: once the seat resolves to STRATEGIST the section returns', () => {
    useCollabRole.mockReturnValue(unread(ROLE_READ.NOT_REACHABLE));
    const view = at(appRoutes.settingsRevenue);
    expect(screen.queryByText(REVENUE_CONTENT)).not.toBeInTheDocument();
    view.unmount();
    useCollabRole.mockReturnValue(seat('STRATEGIST'));
    at(appRoutes.settingsRevenue);
    expect(screen.getByText(REVENUE_CONTENT)).toBeInTheDocument();
  });
});

// ── Routing. No redirect means no loop, and Back still works. ────────
describe('R-15 · routing behaviour', () => {
  it('a refused section does NOT redirect — the address is preserved', () => {
    useCollabRole.mockReturnValue(seat('BUYER'));
    at(appRoutes.settingsRevenue);
    // Still the Settings shell, at the same address. A redirect would have
    // replaced the entry and there would be nothing left to refuse.
    expect(screen.getByText(/Workspace Settings/i)).toBeInTheDocument();
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
  });

  it('a refresh on the restricted address lands on the same refusal, not a loop', () => {
    useCollabRole.mockReturnValue(seat('CLIENT'));
    const first = at(appRoutes.settingsRevenue);
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
    first.unmount();
    at(appRoutes.settingsRevenue); // same entry, fresh mount = a refresh
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
  });

  it('query parameters do not change the answer', () => {
    useCollabRole.mockReturnValue(seat('BUYER'));
    at(appRoutes.settingsRevenue + '?section=revenue&role=STRATEGIST');
    expect(screen.queryByText(REVENUE_CONTENT)).not.toBeInTheDocument();
    expect(screen.getByText(REFUSAL)).toBeInTheDocument();
  });

  it('an invented section key (/app/settings/team-and-roles) resolves to General', () => {
    useCollabRole.mockReturnValue(seat('BUYER'));
    at('/app/settings/team-and-roles');
    expect(screen.queryByText(REVENUE_CONTENT)).not.toBeInTheDocument();
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

// ── The declaration itself. One list, two fields, three readers. ─────
describe('R-15 · the audience is declared once, in the manifest', () => {
  it('view and manage are SEPARATE fields, and Team proves they can differ', () => {
    const team = settingsSection('team');
    // The read is open — the API grants it to any member, and so do we.
    expect(team.viewAudience).toBeUndefined();
    // The mutations are not.
    expect(team.manageAudience).toEqual(['STRATEGIST']);
  });

  it('Revenue restricts BOTH axes, stated rather than inferred', () => {
    const revenue = settingsSection('revenue');
    expect(revenue.viewAudience).toEqual(['STRATEGIST']);
    expect(revenue.manageAudience).toEqual(['STRATEGIST']);
  });

  it('the personal sections are unconstrained on both axes', () => {
    for (const key of ['general', 'security']) {
      const s = settingsSection(key);
      expect(s.viewAudience).toBeUndefined();
      expect(s.manageAudience).toBeUndefined();
    }
  });

  it('workspace is an OPEN RULING — unconstrained on both axes, asserted so a change is visible', () => {
    const ws = settingsSection('workspace');
    expect(ws.viewAudience).toBeUndefined();
    expect(ws.manageAudience).toBeUndefined();
  });

  it('no section carries the retired single-axis `roles` field', () => {
    // A leftover `roles` would be read by nothing and would silently document a
    // rule that is no longer enforced anywhere.
    for (const s of settingsSections) {
      expect(Object.prototype.hasOwnProperty.call(s, 'roles')).toBe(false);
    }
  });
});
