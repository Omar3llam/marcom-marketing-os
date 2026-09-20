// ============================================================
// Phase 5.4 — the deferred shell has a boundary, and it is honest
// ------------------------------------------------------------
// `MainLayout` is lazy now, so between "your account is readable" and the app
// appearing there is a chunk in flight. That gap needs a boundary: without one
// the suspension escapes to the root ErrorBoundary and the operator gets
// "Something went wrong" instead of a wait.
//
// Its own file because the gate below can only be opened once — React.lazy
// caches the module it resolved, so a test that observes the PENDING state has
// to be the first thing that renders it.
//
// The fallback is `FullscreenLoader`, the same component the guard on this
// exact route rendered a moment earlier: the shape does not change, only the
// words. It says the app is loading. It does not say anything is ready.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const session = vi.hoisted(() => ({ currentUser: { uid: 'u1' }, loading: false, authReady: true }));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => session }));

const context = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get: (...args) => context.get(...args) } }));

// The chunk, held open until the test lets it arrive.
const gate = vi.hoisted(() => {
  let open;
  const arrived = new Promise((resolve) => { open = resolve; });
  return { arrived, open: () => open() };
});

vi.mock('@/components/layout/MainLayout.jsx', async () => {
  // The race is a safety valve, not part of the contract: if this module is
  // ever imported STATICALLY again, `gate.arrived` is awaited before any test
  // can open it, and without the timeout the whole file would hang instead of
  // failing. The test opens the gate in milliseconds, so the valve never fires
  // on the intended path.
  await Promise.race([gate.arrived, new Promise((r) => { setTimeout(r, 4000); })]);
  const { Outlet } = await import('react-router-dom');
  return { default: () => <div>authenticated-shell<Outlet /></div> };
});

const page = vi.hoisted(() => (name) => ({ default: () => <div>{name}</div> }));
vi.mock('@/pages/Home.jsx', () => page('overview-view'));
vi.mock('@/pages/LandingPage.jsx', () => page('landing'));
vi.mock('@/pages/AuthPage.jsx', () => page('auth'));
vi.mock('@/hooks/useCollabRole.js', async (io) => ({
  ...(await io()),
  useCollabRole: () => ({ role: 'STRATEGIST', loading: false, status: 'PRESENT' }),
  WORKSPACE_ROLE: { CLIENT: 'CLIENT', BUYER: 'BUYER', STRATEGIST: 'STRATEGIST' },
}));
vi.mock('@/hooks/usePlan.js', () => ({ usePlan: () => ({ plan: 'PRO', loading: false, canAccess: () => true }) }));
vi.mock('@/hooks/useUserRole.js', async (io) => ({ ...(await io()), useUserRole: () => ({ isAdmin: true, isLoading: false, status: 'PRESENT' }) }));

const App = (await import('../../App.jsx')).default;

let errorSpy;
beforeEach(() => {
  context.get.mockReset();
  context.get.mockResolvedValue({ data: { context: { name: 'Acme' } } });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

describe('while the shell chunk is in flight', () => {
  it('waits, in the words of a wait — not an error, and not the app', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/app/overview']}><App /></MemoryRouter>,
    );

    // The guard's own loader ("Checking your account…") comes first and is
    // replaced; what this test is about is the one AFTER it, while the chunk
    // is in flight. FullscreenLoader's default words, on purpose: the page is
    // loading, and that is the only thing being claimed.
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(container.textContent).not.toContain('authenticated-shell');
    expect(container.textContent).not.toContain('overview-view');
    // The suspension must not have escaped to the root boundary.
    expect(container.textContent).not.toContain('Something went wrong');

    gate.open();
    expect(await screen.findByText('overview-view')).toBeInTheDocument();
    expect(container.textContent).toContain('authenticated-shell');
  });
});
