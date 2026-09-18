// ============================================================
// Phase 5.4 — the authenticated half is deferred, and stays deferred
// ------------------------------------------------------------
// App.jsx used to import the app shell, the operator home, Content Lab,
// Copilot, the three tools pages, Settings and Observability STATICALLY, so
// every visitor to the public landing downloaded all of them before `/` could
// paint. They are `lazy()` now.
//
// A bundle measurement proves that for one build; this file proves the
// property that makes the measurement stay true — that rendering a public
// route never EVALUATES an authenticated module. Each mock below records the
// moment its factory runs, which is the moment the chunk would have loaded, so
// a future static import anywhere in that graph fails here rather than
// silently re-inflating the landing.
//
// The real App.jsx and the real guards run. Only the session, the account-setup
// read and the leaf modules are mocked.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── the two dependencies the guards read ─────────────────────
const session = vi.hoisted(() => ({ currentUser: { uid: 'u1' }, loading: false, authReady: true }));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => session }));

const context = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get: (...args) => context.get(...args) } }));

// ── the ledger: which deferred modules have been evaluated ───
const loaded = vi.hoisted(() => /** @type {string[]} */ ([]));
/**
 * A leaf that records the instant its module is pulled in, and reports the
 * address it was mounted at — so "the destination survived the boundary" is
 * read from the router, not assumed.
 */
const deferred = vi.hoisted(() => (name) => async () => {
  loaded.push(name);
  const { Outlet, useLocation } = await import('react-router-dom');
  const Leaf = () => {
    const { pathname, search } = useLocation();
    return <div>{name}<span data-testid="where">{pathname}{search}</span><Outlet /></div>;
  };
  return { default: Leaf };
});

vi.mock('@/components/layout/MainLayout.jsx', deferred('shell'));
vi.mock('@/pages/Home.jsx', deferred('overview-view'));
vi.mock('@/pages/ContentLab/index.jsx', deferred('content-view'));
vi.mock('@/pages/CopilotPage.jsx', deferred('copilot-view'));
vi.mock('@/pages/Settings.jsx', deferred('settings-view'));
vi.mock('@/pages/tools/MarketingTools.jsx', deferred('tools-marketing'));
vi.mock('@/pages/tools/SocialCalendar.jsx', deferred('tools-calendar'));
vi.mock('@/pages/tools/ScoreContent.jsx', deferred('tools-score'));
vi.mock('@/pages/OnboardingPage.jsx', deferred('onboarding-wizard'));

// Observability is the failure case: its chunk never arrives.
vi.mock('@/pages/Observability.jsx', async () => {
  loaded.push('observability-view');
  throw new Error('chunk load failed');
});

// Gates stay real; their data sources do not.
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'STRATEGIST', loading: false }),
  WORKSPACE_ROLE: { CLIENT: 'CLIENT', BUYER: 'BUYER', STRATEGIST: 'STRATEGIST' },
}));
vi.mock('@/hooks/usePlan.js', () => ({ usePlan: () => ({ plan: 'PRO', loading: false, canAccess: () => true }) }));
vi.mock('@/hooks/useUserRole.js', () => ({ useUserRole: () => ({ isAdmin: true, isLoading: false }) }));

// Public leaves are plain: they are NOT what this file is watching.
const page = vi.hoisted(() => (name) => ({ default: () => <div>{name}</div> }));
vi.mock('@/pages/LandingPage.jsx', () => page('landing'));
vi.mock('@/pages/PrivacyPage.jsx', () => page('privacy'));
vi.mock('@/pages/TermsPage.jsx', () => page('terms'));
vi.mock('@/pages/AuthPage.jsx', () => page('auth'));

const App = (await import('../../App.jsx')).default;

// What merely IMPORTING App.jsx dragged in. A static import evaluates here,
// before any route is rendered and before `beforeEach` clears the ledger — so
// this snapshot, not the per-render one, is what catches a re-added
// `import X from './pages/…'`.
const atImport = [...loaded];

const at = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

let errorSpy;
beforeEach(() => {
  session.currentUser = { uid: 'u1' };
  session.loading = false;
  session.authReady = true;
  context.get.mockReset();
  context.get.mockResolvedValue({ data: { context: { name: 'Acme' } } });
  loaded.length = 0;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

// ════════════════════════════════════════════════════════════════════════════
describe('a public route pulls in nothing authenticated', () => {
  // The whole slice in one assertion: importing the route table must not
  // evaluate a single authenticated module. Re-add any of them as a static
  // `import` and this is the line that fails.
  it('importing App.jsx evaluates no authenticated module at all', () => {
    expect(atImport).toEqual([]);
  });

  it.each([['/', 'landing'], ['/privacy', 'privacy'], ['/terms', 'terms'], ['/login', 'auth']])(
    '%s renders %s and loads no authenticated module',
    async (path, sentinel) => {
      at(path);
      expect(await screen.findByText(sentinel)).toBeInTheDocument();
      // Give any stray dynamic import a turn of the event loop to betray itself.
      await new Promise((r) => setTimeout(r, 0));
      expect(loaded).toEqual([]);
    },
  );

  it('does not even ask for the account-setup read on the way', async () => {
    at('/');
    await screen.findByText('landing');
    expect(context.get).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('an authenticated route loads its own modules, and only then', () => {
  it('/app/overview brings in the shell and the page it was asked for', async () => {
    at('/app/overview');
    expect(await screen.findByText('overview-view')).toBeInTheDocument();
    expect(loaded).toContain('shell');
    expect(loaded).toContain('overview-view');
    expect(loaded).not.toContain('settings-view');
    expect(loaded).not.toContain('content-view');
  });

  it('/app/settings brings in Settings, not Overview', async () => {
    at('/app/settings');
    expect(await screen.findByText('settings-view')).toBeInTheDocument();
    expect(loaded).not.toContain('overview-view');
  });

  it('keeps a route parameter across the deferred boundary', async () => {
    at('/app/settings/notifications');
    expect(await screen.findByText('settings-view')).toBeInTheDocument();
    expect(screen.getAllByTestId('where').at(-1)).toHaveTextContent('/app/settings/notifications');
  });

  it('keeps a query string across the deferred boundary', async () => {
    at('/app/content?draft=42');
    expect(await screen.findByText('content-view')).toBeInTheDocument();
    expect(screen.getAllByTestId('where').at(-1)).toHaveTextContent('/app/content?draft=42');
  });

  it('/onboarding brings in the wizard, and nothing from the shell', async () => {
    context.get.mockResolvedValue({ data: { context: {} } });
    at('/onboarding');
    expect(await screen.findByText('onboarding-wizard')).toBeInTheDocument();
    expect(loaded).not.toContain('shell');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the boundary is still a boundary', () => {
  it('an unauthenticated visitor gets login, and no authenticated module loads', async () => {
    session.currentUser = null;
    const { container } = at('/app/overview');
    await waitFor(() => expect(container.textContent).toContain('auth'));
    expect(loaded).toEqual([]);
  });

  it('a session that has not resolved holds the route and loads nothing', async () => {
    session.authReady = false;
    session.loading = true;
    at('/app/overview');
    expect(await screen.findByRole('status')).toHaveTextContent('Restoring your session…');
    expect(loaded).toEqual([]);
  });

  it('a chunk that fails to arrive reaches the error boundary, not a blank page', async () => {
    at('/app/observability');
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(loaded).toContain('observability-view');
  });
});
