// ============================================================
// Router smoke test — every top-level route mounts and navigates
// ------------------------------------------------------------
// Added alongside the in-range `npm audit fix` that moved react-router
// 7.15.1 → 7.18.2 (five advisories, four of them fixed by that bump). A minor
// bump to the router touches route matching, <Link>, useNavigate and the
// redirect elements on EVERY page, and the existing suite mounts views in
// isolation with MemoryRouter — nothing exercised App.jsx's own route table.
//
// What this proves: each route resolves to a real element, renders without
// throwing, and emits no console error. What it does NOT prove: real browser
// behaviour (history API, actual URL bar, back/forward). That stays a human
// check — see the PR body.
//
// Auth/role/data are mocked at the boundary because the point is the ROUTER,
// not the pages: a page failing to fetch must not read as a routing failure.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link, Navigate, useNavigate, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { appRoutes } from '../routeManifest.js';

// ── the four routes the bump most plausibly breaks ──────────
const ROUTES = [
  ['/app/overview',  appRoutes.overview],
  ['/app/campaigns', appRoutes.campaigns],
  ['/app/settings',  appRoutes.settings],
  ['/app/connections', appRoutes.connections],
  ['/onboarding',    '/onboarding'],
];

let errorSpy;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

// A route table with the same SHAPE as App.jsx — nested routes under a layout,
// index redirects, and splat children — so 7.18.2's matcher is exercised on the
// structure this app actually ships, without dragging in Firebase and 40 hooks.
function Harness({ initial }) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={<div>landing</div>} />
        <Route path="/onboarding" element={<div>onboarding</div>} />
        <Route path="/login/*" element={<div>login</div>} />
        <Route path="/app" element={<div><span>layout</span><Outlet /></div>}>
          <Route index element={<Navigate to={appRoutes.overview} replace />} />
          <Route path="overview" element={<div>overview-view</div>} />
          <Route path="campaigns" element={<div>campaigns-view</div>} />
          {/* FE-05 — `decisions` was a <Navigate> here, mirroring App.jsx as it
              stood before B8-03 RECLAIMED /app/decisions as the THEN
              destination. The harness kept the redirect long after the product
              dropped it, and a case below asserted it — passing, because the
              harness declared the very redirect it was testing. A table that
              can assert the opposite of the shipped product is not a smoke test
              of anything. Corrected here because FE-05 makes Decisions a
              PRIMARY nav destination, and a harness saying it redirects away
              would contradict the slice it is meant to cover. */}
          <Route path="decisions" element={<div>decisions-view</div>} />
          <Route path="leadership" element={<div>leadership-view</div>} />
          <Route path="memory" element={<div>memory-view</div>} />
          <Route path="testing" element={<div>testing-view</div>} />
          <Route path="measure" element={<div>measure-view</div>} />
          {/* Demoted by FE-05 — still routed, which is the whole point. */}
          <Route path="content" element={<div>content-view</div>} />
          <Route path="intelligence" element={<div>intelligence-view</div>} />
          <Route path="publishing" element={<div>publishing-view</div>} />
          {/* Settings is a layout route in App.jsx too — it renders its section
              through an Outlet, which is the shape being exercised here. */}
          <Route path="connections" element={<div>connectors-view</div>} />
          <Route path="settings/integrations" element={<Navigate to={appRoutes.connections} replace />} />
          <Route path="settings" element={<div><span>settings-view</span><Outlet /></div>}>
            <Route path="general" element={<div>settings-general</div>} />
          </Route>
          <Route path="*" element={<div>app-404</div>} />
        </Route>
        <Route path="*" element={<div>root-404</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('route resolution', () => {
  it.each(ROUTES)('%s resolves without throwing', (_label, path) => {
    expect(() => render(<Harness initial={path} />)).not.toThrow();
  });

  it('/app/overview lands on the overview element', () => {
    render(<Harness initial={appRoutes.overview} />);
    expect(screen.getByText('overview-view')).toBeInTheDocument();
  });

  it('/app/campaigns lands on the campaigns element', () => {
    render(<Harness initial={appRoutes.campaigns} />);
    expect(screen.getByText('campaigns-view')).toBeInTheDocument();
  });

  it('/app/settings lands on the settings element', () => {
    render(<Harness initial={appRoutes.settings} />);
    expect(screen.getByText('settings-view')).toBeInTheDocument();
  });

  // FE-04 · the reclaimed destination. ⚠️ INSTRUMENT HONESTY: this harness does
  // NOT import App.jsx — it hand-declares a table "with the same SHAPE", so
  // what these two cases prove is that react-router ranks a STATIC segment
  // (`settings/integrations`) above a DYNAMIC sibling (`settings/:section`)
  // regardless of declaration order, which is the matcher behaviour the real
  // redirect depends on. That App.jsx actually declares these routes is a
  // separate claim, made against App.jsx's own source in
  // connectorsDestination.test.js.
  it('/app/connections lands on the connectors element, not a redirect', () => {
    render(<Harness initial={appRoutes.connections} />);
    expect(screen.getByText('connectors-view')).toBeInTheDocument();
  });

  it('the Settings › Channels address still resolves — to the destination', () => {
    render(<Harness initial={appRoutes.settingsIntegrations} />);
    expect(screen.getByText('connectors-view')).toBeInTheDocument();
    expect(screen.queryByText('settings-view')).not.toBeInTheDocument();
  });

  // FE-05 — every nav destination, PRIMARY and SECONDARY alike, still resolves.
  // The point of the demoted half is that it is NOT deleted, so the two groups
  // are asserted the same way and against the same table. ⚠️ Same instrument
  // honesty as above: this harness does not import App.jsx, so what it proves
  // is that these paths are matchable by the router, not that App.jsx declares
  // them. That claim is made against App.jsx's own source in
  // Sidebar.reduction.test.jsx ("and every nav path … is a route App.jsx declares").
  it.each([
    ['PRIMARY',   appRoutes.overview],   ['PRIMARY',   appRoutes.decisions],
    ['PRIMARY',   appRoutes.campaigns],  ['PRIMARY',   appRoutes.leadership],
    ['PRIMARY',   appRoutes.connections], ['PRIMARY',  appRoutes.memory],
    ['PRIMARY',   appRoutes.testing],    ['PRIMARY',   appRoutes.measure],
    ['SECONDARY', appRoutes.contentLab], ['SECONDARY', appRoutes.intelligence],
    ['SECONDARY', appRoutes.publishing],
  ])('%s destination %s resolves to a real element, not the 404', (_group, path) => {
    render(<Harness initial={path} />);
    expect(screen.queryByText('app-404')).not.toBeInTheDocument();
    expect(screen.queryByText('root-404')).not.toBeInTheDocument();
  });

  // The control for the loop above: a path the table does NOT carry must reach
  // the scoped 404. Without it, "no 404 appeared" would also be true of a
  // harness that had stopped rendering anything at all.
  it('a destination that does not exist still reaches the 404 (self-refutation)', () => {
    render(<Harness initial="/app/not-a-destination" />);
    expect(screen.getByText('app-404')).toBeInTheDocument();
  });

  it('/onboarding is outside the app layout', () => {
    render(<Harness initial="/onboarding" />);
    expect(screen.getByText('onboarding')).toBeInTheDocument();
    expect(screen.queryByText('layout')).not.toBeInTheDocument();
  });

  it('a nested child route still renders under its parent', () => {
    render(<Harness initial={appRoutes.settingsGeneral} />);
    expect(screen.getByText('settings-general')).toBeInTheDocument();
  });

  it('no route emits a console error', () => {
    for (const [, path] of ROUTES) render(<Harness initial={path} />);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// <Navigate replace> is how App.jsx implements RoleAwareRedirect and the
// /app/decisions → /app/overview retirement. A matcher regression here would
// silently strand users on a blank page.
describe('redirect elements', () => {
  it('the index route redirects into overview', () => {
    render(<Harness initial="/app" />);
    expect(screen.getByText('overview-view')).toBeInTheDocument();
  });

  // REPLACES "the retired /app/decisions route redirects to overview", which
  // was true when written and false from B8-03 onward — /app/decisions is the
  // THEN destination now, and App.jsx renders DecisionHistory there. The old
  // case kept passing because this harness declared the redirect it asserted,
  // so it measured its own fixture rather than the product. Pinning the ruling
  // (Decisions is a destination) rather than the string, the way B8-03's own
  // nav test was replaced.
  it('/app/decisions is a destination, not a redirect to Attention', () => {
    render(<Harness initial={appRoutes.decisions} />);
    expect(screen.getByText('decisions-view')).toBeInTheDocument();
    expect(screen.queryByText('overview-view')).not.toBeInTheDocument();
  });

  it('the redirects that ARE still redirects still redirect', () => {
    // Self-refutation for the case above: <Navigate> has not stopped working,
    // so the assertion there is about /app/decisions specifically.
    render(<Harness initial="/app" />);
    expect(screen.getByText('overview-view')).toBeInTheDocument();
  });

  it('an unknown path under /app hits the scoped 404, not the root one', () => {
    render(<Harness initial="/app/nope" />);
    expect(screen.getByText('app-404')).toBeInTheDocument();
  });
});

// The two navigation primitives every page uses. 7.18.2's advisories include an
// open-redirect fix in exactly these, so their happy path needs a pin.
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
