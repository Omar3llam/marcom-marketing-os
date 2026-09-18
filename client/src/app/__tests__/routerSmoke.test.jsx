// ============================================================
// Router smoke test — against the REAL App.jsx  (PARITY-02)
// ------------------------------------------------------------
// ⚠️ WHAT CHANGED, AND WHY IT HAD TO
//
// This file used to declare its OWN <Routes> table "with the same SHAPE as
// App.jsx" and assert against that. It said so honestly in two comments, and it
// pointed at the files where the real claims were made — but a table that can
// be edited independently of the product can also disagree with it, and once
// did: it kept `<Route path="decisions" element={<Navigate …/>}>` long after
// B8-03 made /app/decisions the THEN destination, and a case asserted that
// redirect and PASSED. FE-05 corrected the drift. The mechanism that produced
// it survived the correction.
//
//     harness route table  ≠  production route table
//
// So the harness is gone and `App.jsx` itself is rendered. Two things follow,
// and the second is the one Parity needed:
//
//   1. The route table under test is now the shipped one, BY CONSTRUCTION. The
//      cases are generated from App.jsx's own source, so a route added tomorrow
//      is covered tomorrow — coverage stops being a promise and becomes a
//      measurement (see `declaredRoutes` below).
//
//   2. The GATES are real. RoleGate, PlanGate, RequireUserRole, LockFromClient
//      and RoleAwareRedirect all execute. The old table declared none of them,
//      so it could not answer the question route parity actually asks: can this
//      seat, on this plan, reach this destination? It can now.
//
// WHAT IS MOCKED, AND WHY THAT IS STILL HONEST
// The gates' DATA SOURCES (useCollabRole, usePlan, useUserRole) and the shell
// (auth, ProtectedRoute, MainLayout) — because the point is the router, not a
// Firebase round trip. The GATES THEMSELVES ARE REAL. Route elements are
// sentinels, because what is under test is which element a URL reaches, not
// what that element renders.
//
// WHAT THIS STILL DOES NOT PROVE: real browser behaviour — history, the URL
// bar, back/forward. That stays a human check.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appRoutes } from '../routeManifest.js';

// ── the seat under test, settable per case ──────────────────────────────────
const seat = vi.hoisted(() => ({
  role: 'STRATEGIST', roleLoading: false,
  plan: 'PRO', planLoading: false,
  isAdmin: false, adminLoading: false,
}));

// ── the gates' data sources (the gates themselves stay REAL) ────────────────
const RANK = vi.hoisted(() => ({ FREE: 0, GROWTH: 1, PRO: 2 }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: seat.role, loading: seat.roleLoading }),
  WORKSPACE_ROLE: { CLIENT: 'CLIENT', BUYER: 'BUYER', STRATEGIST: 'STRATEGIST' },
}));
vi.mock('@/hooks/usePlan.js', () => ({
  usePlan: () => ({
    plan: seat.plan,
    loading: seat.planLoading,
    // Mirrors the real hierarchical check: an absent requirement is open.
    canAccess: (required) => required == null || RANK[seat.plan] >= RANK[required],
  }),
}));
vi.mock('@/hooks/useUserRole.js', () => ({
  useUserRole: () => ({ isAdmin: seat.isAdmin, isLoading: seat.adminLoading }),
}));

// ── the shell: auth + the two fetching route wrappers ───────────────────────
vi.mock('@/context/AuthContext.jsx', () => ({
  // Phase 5.2 — authReady joined the contract: the guards hold a route until
  // Firebase has answered, and this harness is testing the table, not the wait.
  useAuth: () => ({ loading: false, authReady: true, currentUser: { uid: 'u1' } }),
}));
vi.mock('@/router/ProtectedRoute.jsx', () => ({
  ProtectedRoute: ({ children }) => children,
  OnboardingRoute: ({ children }) => children,
  // Phase 5.2 — /admin answers the SESSION question before the role one.
  AdminRoute: ({ children }) => children,
}));
vi.mock('@/components/layout/MainLayout.jsx', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <div><span>layout</span><Outlet /></div> };
});

// ── one sentinel per route element ──────────────────────────────────────────
// Every module App.jsx mounts as a route element. The coverage test below reads
// App.jsx and fails if it grows one this list does not carry, so this cannot
// quietly fall behind the product the way the old table did.
const page = vi.hoisted(() => (name) => ({ default: () => <div>{name}</div> }));
vi.mock('@/pages/LandingPage.jsx', () => page('landing'));
vi.mock('@/pages/PrivacyPage.jsx', () => page('privacy'));
vi.mock('@/pages/TermsPage.jsx', () => page('terms'));
vi.mock('@/pages/AuthPage.jsx', () => page('auth'));
vi.mock('@/pages/OnboardingPage.jsx', () => page('onboarding'));
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

import App from '../../App.jsx';

// ── the route table, read from the product ──────────────────────────────────
// Generated, not transcribed. The whole defect this file closes was a
// transcription that could drift.
// vitest's root is client/, so App.jsx sits at src/App.jsx from cwd. Read as
// TEXT — the cases below are generated from the product's own declarations, and
// the first control asserts this read actually landed.
const APP_SRC = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8');
const APP_MODULES = [...APP_SRC.matchAll(/(?:from|import\()\s*'(\.\/(?:pages|features)\/[^']+)'/g)].map((m) => m[1]);
const ROUTE_DECLS = [...APP_SRC.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

/** A declared path → a URL that should match it. Splat and 404 rows dropped. */
function navigableFrom(declared) {
  const out = [];
  for (const p of declared) {
    if (p === '*') continue;                                  // the 404s, tested by name
    const abs = p.startsWith('/') ? p : `/app/${p}`;
    out.push(abs.replace(/\/\*$/, '').replace(/:[A-Za-z]+/g, 'sample-id'));
  }
  return [...new Set(out)];
}
const NAVIGABLE = navigableFrom(ROUTE_DECLS);

let errorSpy;
beforeEach(() => {
  seat.role = 'STRATEGIST'; seat.roleLoading = false;
  seat.plan = 'PRO'; seat.planLoading = false;
  seat.isAdmin = false; seat.adminLoading = false;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

const at = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const lands = async (text) => waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());

// ════════════════════════════════════════════════════════════════════════════
// The instrument must be reading the product before any finding means anything
// ════════════════════════════════════════════════════════════════════════════
describe('PARITY-02 · the harness reads the shipped route table', () => {
  it('parsed App.jsx, and did not parse a fiction', () => {
    expect(ROUTE_DECLS.length).toBeGreaterThan(25);
    expect(ROUTE_DECLS).toContain('decisions/:id');
    expect(ROUTE_DECLS).toContain('settings/integrations');
    expect(ROUTE_DECLS).not.toContain('zzz-not-a-route');
    // PROSE IS NOT PRODUCT. App.jsx's header comment documents the tree in
    // route-shaped language — `tools/*`, `/app/*`, `index → /app/feed` — and
    // none of it is a declaration. `tools/*` is the sharpest case: the real
    // table declares tools/score, tools/calendar and tools/marketing, never the
    // glob, so finding it here would mean the parser had read the documentation.
    expect(APP_SRC).toContain('tools/*');          // it IS in the file…
    expect(ROUTE_DECLS).not.toContain('tools/*');  // …and it is NOT a route
    expect(ROUTE_DECLS).toContain('tools/score');
    // /app is a real declaration — the shell — and its index redirect is what
    // makes it navigable.
    expect(NAVIGABLE).toContain('/app');
    expect(NAVIGABLE).toContain('/app/overview');
  });

  it('every route element App.jsx mounts has a sentinel here', () => {
    // Coverage as a measurement. Add a page to App.jsx without adding it here
    // and this fails — which is the property the old hand-written table could
    // not have, because it did not know what App.jsx contained.
    const mocked = new Set([
      './pages/LandingPage.jsx', './pages/PrivacyPage.jsx', './pages/TermsPage.jsx',
      './pages/AuthPage.jsx', './pages/OnboardingPage.jsx', './pages/Home.jsx',
      './pages/ContentLab/index.jsx', './pages/CopilotPage.jsx',
      './pages/tools/MarketingTools.jsx', './pages/tools/SocialCalendar.jsx',
      './pages/tools/ScoreContent.jsx', './pages/Settings.jsx', './pages/Observability.jsx',
      './pages/CampaignAnalysis.jsx', './pages/GrowthStrategyBoard.jsx',
      './pages/demo/Operations/index.jsx', './pages/ApprovalQueue.jsx',
      './pages/Publishing.jsx', './pages/BlendedTruth.jsx', './pages/AdminPanel.jsx',
      './pages/Testing.jsx', './pages/Measure.jsx', './pages/Leadership.jsx',
      './features/decisions/DecisionHistoryView.jsx', './features/decisions/DecisionDetailView.jsx',
      './features/memory/MemoryView.jsx', './features/connectors/ConnectorsView.jsx',
      './features/testing/TestDetailView.jsx', './features/measurement/HoldoutDetailView.jsx',
    ]);
    expect(APP_MODULES.filter((m) => !mocked.has(m))).toEqual([]);
    expect(APP_MODULES.length).toBeGreaterThan(25);
  });

  it('a destination that does not exist reaches the scoped 404 (self-refutation)', async () => {
    at('/app/not-a-destination');
    await lands('Page not found');
    expect(screen.queryByText('overview-view')).not.toBeInTheDocument();
  });

  it('and an unknown path OUTSIDE /app reaches the root one', async () => {
    at('/nope');
    await lands('Page not found');
    expect(screen.queryByText('layout')).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Every declared route, generated from the product
// ════════════════════════════════════════════════════════════════════════════
describe('PARITY-02 · every route App.jsx declares resolves', () => {
  it.each(NAVIGABLE)('%s renders an element, not the 404', async (path) => {
    at(path);
    await waitFor(() => expect(screen.queryByText('Page not found')).not.toBeInTheDocument());
  });

  it('no declared route emits a console error', async () => {
    for (const path of NAVIGABLE) {
      at(path);
      await waitFor(() => expect(screen.queryByText('Page not found')).not.toBeInTheDocument());
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Named landings and redirects — now against the shipped table
// ════════════════════════════════════════════════════════════════════════════
describe('PARITY-02 · destinations land where they say', () => {
  it.each([
    [appRoutes.overview, 'overview-view'],
    [appRoutes.decisions, 'decisions-view'],
    [appRoutes.campaigns, 'campaigns-view'],
    [appRoutes.memory, 'memory-view'],
    [appRoutes.connections, 'connectors-view'],
    [appRoutes.leadership, 'leadership-view'],
    [appRoutes.testing, 'testing-view'],
    [appRoutes.measure, 'measure-view'],
    [appRoutes.settings, 'settings-view'],
  ])('%s lands on %s', async (path, sentinel) => {
    at(path);
    await lands(sentinel);
  });

  it('/app/decisions is a DESTINATION, not a redirect to Attention (B8-03)', async () => {
    at(appRoutes.decisions);
    await lands('decisions-view');
    expect(screen.queryByText('overview-view')).not.toBeInTheDocument();
  });

  it('the Settings › Channels address redirects to the destination (FE-04)', async () => {
    at(appRoutes.settingsIntegrations);
    await lands('connectors-view');
    expect(screen.queryByText('settings-view')).not.toBeInTheDocument();
  });

  it.each([
    ['/app/home', 'overview-view'], ['/app/feed', 'overview-view'],
    ['/app/truth', 'blended-truth-view'], ['/app/proof', 'memory-view'],
    ['/app/growth', 'insights-view'], ['/app/intelligence', 'blended-truth-view'],
    ['/app/intelligence/proof', 'memory-view'],
  ])('%s redirects to %s, in one hop', async (from, sentinel) => {
    at(from);
    await lands(sentinel);
  });

  it('/onboarding is outside the app layout', async () => {
    at('/onboarding');
    await lands('onboarding');
    expect(screen.queryByText('layout')).not.toBeInTheDocument();
  });

  it('a static segment outranks its dynamic sibling', async () => {
    // settings/integrations vs settings/:section — the matcher behaviour FE-04's
    // redirect depends on, asserted against the real declarations this time.
    at(appRoutes.settingsIntegrations);
    await lands('connectors-view');
    at(appRoutes.settingsGeneral);
    await lands('settings-view');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// THE CAPABILITY THE OLD HARNESS DID NOT HAVE: the gates are real
// ════════════════════════════════════════════════════════════════════════════
describe('PARITY-02 · a CLIENT seat meets the gates that exist', () => {
  beforeEach(() => { seat.role = 'CLIENT'; });

  it('the app index sends a CLIENT to Reports, not Attention', async () => {
    at('/app');
    await lands('leadership-view');
    expect(screen.queryByText('overview-view')).not.toBeInTheDocument();
  });

  it.each([
    ['Attention (LockFromClient)', appRoutes.overview],
    ['Campaigns (LockFromClient)', appRoutes.campaigns],
    ['Testing (RoleGate)', appRoutes.testing],
    ['Measurement (RoleGate)', appRoutes.measure],
    ['Connectors (RoleGate)', appRoutes.connections],
    ['Blended Truth (RoleGate)', appRoutes.blendedTruth],
    ['Growth Strategy (RoleGate)', appRoutes.insights],
    ['Publishing (RoleGate)', appRoutes.publishing],
    ['Creative Optimizer (LockFromClient)', appRoutes.contentLab],
  ])('is turned away from %s', async (_label, path) => {
    at(path);
    await lands('leadership-view');
  });

  // ⚠️ RECORDED, NOT CHANGED. Parity does not redistribute entitlement — these
  // two are open findings with their own rulings pending, and pinning them here
  // means nobody closes them by accident in a slice about something else.
  it('but REACHES /app/decisions — B8-03 left it ungated deliberately', async () => {
    at(appRoutes.decisions);
    await lands('decisions-view');
  });

  it('…and its detail, on the same ruling', async () => {
    at(`${appRoutes.decisions}/d-1`);
    await lands('decision-detail-view');
  });

  it('…and /app/memory, which FE-02 gated on PLAN only', async () => {
    at(appRoutes.memory);
    await lands('memory-view');
  });

  // The other half of that finding — that the Sidebar offers a CLIENT none of
  // these three — is not asserted here, because it already has an owner:
  // Sidebar.reduction.test.jsx pins the frozen gate table and that a CLIENT's
  // primary nav is exactly ['leadership']. Reachable ≠ discoverable; this file
  // owns REACHABLE.
});

describe('PARITY-02 · the plan gates are real too', () => {
  it.each([
    ['Memory', 'GROWTH', 'FREE', appRoutes.memory],
    ['Testing', 'PRO', 'GROWTH', appRoutes.testing],
    ['Measurement', 'PRO', 'GROWTH', appRoutes.measure],
    ['Publishing', 'GROWTH', 'FREE', appRoutes.publishing],
    ['Blended Truth', 'GROWTH', 'FREE', appRoutes.blendedTruth],
  ])('%s needs %s: a %s workspace gets the upgrade wall, not the page', async (_label, _need, below, path) => {
    seat.plan = below;
    at(path);
    await waitFor(() => expect(screen.getByText(/upgrade/i)).toBeInTheDocument());
  });

  it('…and the entitled workspace gets the page (self-refutation)', async () => {
    seat.plan = 'PRO';
    at(appRoutes.testing);
    await lands('testing-view');
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
  });

  it('Connectors carries NO plan gate — data ingestion is not monetized (FE-04)', async () => {
    seat.plan = 'FREE';
    at(appRoutes.connections);
    await lands('connectors-view');
  });

  it('Decisions carries no plan gate either (B7 Ruling 3)', async () => {
    seat.plan = 'FREE';
    at(appRoutes.decisions);
    await lands('decisions-view');
  });
});

describe('PARITY-02 · nothing is claimed while a gate is still loading', () => {
  it('an unresolved ROLE renders neither the page nor the bounce', async () => {
    // RoleGate returns null while loading — never the fallback — because the
    // fallback is a redirect, and firing it mid-load bounces an entitled
    // operator off a page they are allowed to see.
    seat.role = 'CLIENT'; seat.roleLoading = true;
    at(appRoutes.testing);
    await waitFor(() => expect(screen.getByText('layout')).toBeInTheDocument());
    expect(screen.queryByText('testing-view')).not.toBeInTheDocument();
    expect(screen.queryByText('leadership-view')).not.toBeInTheDocument();
  });

  it('an unresolved PLAN does not flash an upgrade wall at a paying operator', async () => {
    seat.plan = 'FREE'; seat.planLoading = true;
    at(appRoutes.testing);
    await waitFor(() => expect(screen.getByText('layout')).toBeInTheDocument());
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
  });

  it('LockFromClient errs OPEN while the role loads — Attention may not flicker', async () => {
    seat.role = 'CLIENT'; seat.roleLoading = true;
    at(appRoutes.overview);
    await lands('overview-view');
  });
});

describe('PARITY-02 · /admin is outside the shell and ADMIN-only', () => {
  it('a non-admin is bounced to Attention', async () => {
    seat.isAdmin = false;
    at('/admin');
    await lands('overview-view');
    expect(screen.queryByText('admin-view')).not.toBeInTheDocument();
  });

  it('an admin gets the panel, with no app layout around it', async () => {
    seat.isAdmin = true;
    at('/admin');
    await lands('admin-view');
    expect(screen.queryByText('layout')).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The router library itself. Unchanged: these are react-router's own
// primitives, pinned when 7.15.1 → 7.18.2 landed (an open-redirect fix touches
// exactly these). They deliberately use their own tiny tables — the subject
// here is the library, not App.jsx.
// ════════════════════════════════════════════════════════════════════════════
describe('navigation primitives', () => {
  function LinkNav() {
    return (
      <MemoryRouter initialEntries={[appRoutes.overview]}>
        <Link to={appRoutes.campaigns}>go-campaigns</Link>
        <Routes>
          <Route path="/app/overview" element={<div>on-overview</div>} />
          <Route path="/app/campaigns" element={<div>on-campaigns</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('<Link> navigates', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<LinkNav />);
    expect(screen.getByText('on-overview')).toBeInTheDocument();
    await userEvent.click(screen.getByText('go-campaigns'));
    await waitFor(() => expect(screen.getByText('on-campaigns')).toBeInTheDocument());
  });

  it('useNavigate navigates', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    function Pusher() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate(appRoutes.campaigns)}>push</button>;
    }
    render(
      <MemoryRouter initialEntries={[appRoutes.overview]}>
        <Pusher />
        <Routes>
          <Route path="/app/overview" element={<div>on-overview</div>} />
          <Route path="/app/campaigns" element={<div>on-campaigns</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'push' }));
    await waitFor(() => expect(screen.getByText('on-campaigns')).toBeInTheDocument());
  });

  it('state survives a navigation round-trip', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    function Counter() {
      const [n, setN] = useState(0);
      return <button type="button" onClick={() => setN(n + 1)}>count-{n}</button>;
    }
    render(
      <MemoryRouter initialEntries={[appRoutes.overview]}>
        <Counter />
        <Routes><Route path="/app/overview" element={<div>ok</div>} /></Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'count-0' }));
    expect(screen.getByRole('button', { name: 'count-1' })).toBeInTheDocument();
  });
});
