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
          <Route path="decisions" element={<Navigate to={appRoutes.overview} replace />} />
          {/* Settings is a layout route in App.jsx too — it renders its section
              through an Outlet, which is the shape being exercised here. */}
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

  it('the retired /app/decisions route redirects to overview', () => {
    render(<Harness initial="/app/decisions" />);
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
