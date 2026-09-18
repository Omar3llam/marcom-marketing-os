// ============================================================
// Phase 5.2 — the public page does not wait for the authenticated app
// ------------------------------------------------------------
// App.jsx used to return a full-screen "Initializing authentication…" for
// EVERY path while Firebase resolved, so the landing — which reads no session,
// no workspace and no plan — was gated on a service it never consumes.
//
// The boundary moved onto the routes that actually need it. This file holds
// BOTH halves of that claim, because moving a gate is only safe if the thing it
// was guarding is still guarded:
//
//   public  → renders while the session is unresolved
//   /app/*  → still renders nothing but a wait, and never the app
//
// The REAL App.jsx and the REAL guards run here. Only the session, the
// account-setup read and the leaf pages are mocked.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const session = vi.hoisted(() => ({ currentUser: null, loading: true, authReady: false }));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => session }));

const context = vi.hoisted(() => ({ get: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/lib/api.js', () => ({ api: { get: (...args) => context.get(...args) } }));

// The gates' data sources — the gates themselves stay real.
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'STRATEGIST', loading: false }),
  WORKSPACE_ROLE: { CLIENT: 'CLIENT', BUYER: 'BUYER', STRATEGIST: 'STRATEGIST' },
}));
vi.mock('@/hooks/usePlan.js', () => ({
  usePlan: () => ({ plan: 'PRO', loading: false, canAccess: () => true }),
}));
vi.mock('@/hooks/useUserRole.js', () => ({ useUserRole: () => ({ isAdmin: true, isLoading: false }) }));
vi.mock('@/components/layout/MainLayout.jsx', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <div>authenticated-shell<Outlet /></div> };
});

const page = vi.hoisted(() => (name) => ({ default: () => <div>{name}</div> }));
vi.mock('@/pages/LandingPage.jsx', () => page('landing'));
vi.mock('@/pages/PrivacyPage.jsx', () => page('privacy'));
vi.mock('@/pages/TermsPage.jsx', () => page('terms'));
vi.mock('@/pages/AuthPage.jsx', () => page('auth'));
vi.mock('@/pages/OnboardingPage.jsx', () => page('onboarding-wizard'));
vi.mock('@/pages/Home.jsx', () => page('overview-view'));
vi.mock('@/pages/ContentLab/index.jsx', () => page('content-view'));
vi.mock('@/pages/CopilotPage.jsx', () => page('copilot-view'));
vi.mock('@/pages/tools/MarketingTools.jsx', () => page('tools-marketing'));
vi.mock('@/pages/tools/SocialCalendar.jsx', () => page('tools-calendar'));
vi.mock('@/pages/tools/ScoreContent.jsx', () => page('tools-score'));
vi.mock('@/pages/Settings.jsx', () => page('settings-view'));
vi.mock('@/pages/Observability.jsx', () => page('observability-view'));
vi.mock('@/pages/CampaignAnalysis.jsx', () => page('campaigns-view'));
vi.mock('@/pages/GrowthStrategyBoard.jsx', () => page('insights-view'));
vi.mock('@/pages/demo/Operations/index.jsx', () => page('operations-view'));
vi.mock('@/pages/ApprovalQueue.jsx', () => page('approvals-view'));
vi.mock('@/pages/Publishing.jsx', () => page('publishing-view'));
vi.mock('@/pages/BlendedTruth.jsx', () => page('blended-truth-view'));
vi.mock('@/pages/AdminPanel.jsx', () => page('admin-view'));
vi.mock('@/pages/Testing.jsx', () => page('testing-view'));
vi.mock('@/pages/Measure.jsx', () => page('measure-view'));
vi.mock('@/pages/Leadership.jsx', () => page('leadership-view'));
vi.mock('@/features/decisions/DecisionHistoryView.jsx', () => page('decisions-view'));
vi.mock('@/features/decisions/DecisionDetailView.jsx', () => page('decision-detail-view'));
vi.mock('@/features/memory/MemoryView.jsx', () => page('memory-view'));
vi.mock('@/features/connectors/ConnectorsView.jsx', () => page('connectors-view'));
vi.mock('@/features/testing/TestDetailView.jsx', () => page('test-detail-view'));
vi.mock('@/features/measurement/HoldoutDetailView.jsx', () => page('holdout-detail-view'));

const App = (await import('../../App.jsx')).default;

const at = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

let errorSpy;
beforeEach(() => {
  session.currentUser = null;
  session.loading = true;
  session.authReady = false;
  context.get.mockClear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

describe('the public half renders while the session is still unresolved', () => {
  it.each([['/', 'landing'], ['/privacy', 'privacy'], ['/terms', 'terms']])(
    '%s renders %s without waiting for Firebase',
    async (path, sentinel) => {
      at(path);
      expect(await screen.findByText(sentinel)).toBeInTheDocument();
      expect(screen.queryByText(/Initializing authentication/)).toBeNull();
    },
  );

  it('asks for nothing protected on the way', async () => {
    at('/');
    await screen.findByText('landing');
    expect(context.get).not.toHaveBeenCalled();
  });

  it('still renders the landing once a session DOES resolve — signed in or not', async () => {
    session.loading = false;
    session.authReady = true;
    session.currentUser = { uid: 'u1' };
    at('/');
    expect(await screen.findByText('landing')).toBeInTheDocument();
  });
});

describe('the authenticated half is still guarded', () => {
  it('/app/overview renders a wait, never the shell, while the session is unresolved', async () => {
    const { container } = at('/app/overview');
    expect(await screen.findByRole('status')).toHaveTextContent('Restoring your session…');
    expect(container.textContent).not.toContain('authenticated-shell');
    expect(container.textContent).not.toContain('overview-view');
  });

  it('/onboarding is guarded the same way', async () => {
    const { container } = at('/onboarding');
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(container.textContent).not.toContain('onboarding-wizard');
  });

  it('/admin waits for the session before the ADMIN role is even consulted', async () => {
    const { container } = at('/admin');
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(container.textContent).not.toContain('admin-view');
  });

  it('an unauthenticated visitor to /app/overview is sent to login, not into the shell', async () => {
    session.loading = false;
    session.authReady = true;
    session.currentUser = null;
    const { container } = at('/app/overview');
    await waitFor(() => expect(container.textContent).toContain('auth'));
    expect(container.textContent).not.toContain('authenticated-shell');
  });
});
