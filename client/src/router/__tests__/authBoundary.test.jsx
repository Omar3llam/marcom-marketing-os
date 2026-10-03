// ============================================================
// Phase 5.2 — the auth boundary, behaviour by behaviour
// ------------------------------------------------------------
// The guards are REAL here; only their two data sources are mocked — the
// session (AuthContext) and the account-setup read (the api client). What is
// under test is what each guard DOES with an answer, and, more importantly,
// what it does with a NON-answer: four outcomes that must stay distinct.
//
//   LOADING · onboarded · not onboarded · UNREADABLE
//
// The last one is the reason this file exists: a failed read used to fall back
// to a localStorage flag written by an earlier session, so a network blip chose
// a route. The control for that is `localStorage is never consulted`, which
// plants the stale flag and proves it changes nothing.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const session = vi.hoisted(() => ({ currentUser: { uid: 'u1' }, loading: false, authReady: true }));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => session }));

const context = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get: (...args) => context.get(...args) } }));

const { ProtectedRoute, OnboardingRoute, AdminRoute, primeContextCache, clearContextCache } = await import('../ProtectedRoute.jsx');

const SIGNED_IN = { uid: 'u1' };
const onboarded = { data: { context: { name: 'Acme' } } };
const notOnboarded = { data: { context: {} } };

/** Renders the guard at `path`, with sentinels for every place it can land. */
function at(path, guard) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/*" element={guard === 'onboarding' ? <div>app</div> : <ProtectedRoute><div>app</div></ProtectedRoute>} />
        <Route path="/onboarding" element={guard === 'onboarding' ? <OnboardingRoute><div>onboarding-wizard</div></OnboardingRoute> : <div>onboarding-wizard</div>} />
        <Route path="/admin" element={<AdminRoute><div>admin-panel</div></AdminRoute>} />
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<div>landing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The login page, reporting the destination it was handed. */
function Login() {
  const next = new URLSearchParams(useLocation().search).get('next');
  return <div>login{next ? ` next=${next}` : ''}</div>;
}

/** Reads the destination out of the rendered login route. */
function loginNext(container) {
  const text = container.textContent;
  const match = text.match(/login next=(.+)$/);
  return match ? match[1] : null;
}

let errorSpy;
beforeEach(() => {
  session.currentUser = SIGNED_IN;
  session.loading = false;
  session.authReady = true;
  context.get.mockReset();
  context.get.mockResolvedValue(onboarded);
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

// ════════════════════════════════════════════════════════════════════════════
// Nothing is decided before the session is known
// ════════════════════════════════════════════════════════════════════════════
describe('ProtectedRoute · while the session is unresolved', () => {
  it('holds the route — it neither shows the app nor bounces to login', async () => {
    session.authReady = false;
    session.loading = true;
    const { container } = at('/app/overview');
    expect(await screen.findByRole('status')).toHaveTextContent('Restoring your session…');
    expect(container.textContent).not.toMatch(/app|login/);
    expect(context.get).not.toHaveBeenCalled();
  });

  it('does not ask for a protected read when nobody is signed in', async () => {
    session.currentUser = null;
    at('/app/overview');
    await screen.findByText(/login/);
    expect(context.get).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The destination survives the trip through login
// ════════════════════════════════════════════════════════════════════════════
describe('every guard preserves where the visitor was going', () => {
  beforeEach(() => { session.currentUser = null; });

  it.each([
    ['/app/overview', '/app/overview'],
    ['/app/decisions', '/app/decisions'],
    ['/app/decisions/123', '/app/decisions/123'],
    ['/app/memory?filter=recent', '/app/memory?filter=recent'],
  ])('%s → login carrying %s', async (from, expected) => {
    const { container } = at(from);
    await screen.findByText(/login/);
    expect(loginNext(container)).toBe(expected);
  });

  it('/onboarding keeps its own address, which used to be dropped', async () => {
    const { container } = at('/onboarding', 'onboarding');
    await screen.findByText(/login/);
    expect(loginNext(container)).toBe('/onboarding');
  });

  it('/admin keeps its address instead of being replaced by Overview', async () => {
    const { container } = at('/admin');
    await screen.findByText(/login/);
    expect(loginNext(container)).toBe('/admin');
  });

  it('an authenticated visitor passes the session guard — the ROLE check is not this guard', async () => {
    session.currentUser = SIGNED_IN;
    at('/admin');
    expect(await screen.findByText('admin-panel')).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The account-setup read: four outcomes, four behaviours
// ════════════════════════════════════════════════════════════════════════════
describe('ProtectedRoute · the account-setup read', () => {
  it('while it is in flight, says so and routes nowhere', async () => {
    context.get.mockReturnValue(new Promise(() => {}));
    const { container } = at('/app/overview');
    expect(await screen.findByRole('status')).toHaveTextContent('Checking your account…');
    expect(container.textContent).not.toMatch(/onboarding-wizard|login/);
  });

  it('complete → the app', async () => {
    at('/app/overview');
    expect(await screen.findByText('app')).toBeInTheDocument();
  });

  it('incomplete → onboarding, carrying the destination', async () => {
    context.get.mockResolvedValue(notOnboarded);
    const { container } = at('/app/memory?filter=recent');
    await waitFor(() => expect(container.textContent).toContain('onboarding-wizard'));
  });

  it('UNREADABLE → says so, and routes nowhere at all', async () => {
    context.get.mockRejectedValue(Object.assign(new Error('boom'), { httpStatus: 500 }));
    const { container } = at('/app/overview');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account setup could not be read');
    expect(container.textContent).not.toMatch(/onboarding-wizard|login|>app</);
  });

  it('a 401 is unreadable too — it is never read as "not onboarded"', async () => {
    context.get.mockRejectedValue(Object.assign(new Error('unauthorized'), { httpStatus: 401 }));
    const { container } = at('/app/overview');
    await screen.findByRole('alert');
    expect(container.textContent).not.toContain('onboarding-wizard');
  });

  it('localStorage is never consulted: a stale "onboarded" flag changes nothing', async () => {
    localStorage.setItem('marcom:onboarded', 'true');
    context.get.mockRejectedValue(Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }));
    at('/app/overview');
    // Before Phase 5.2 this cached `true` sent the visitor into the app.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('app')).toBeNull();
  });

  it('and a stale "false" flag does not push a set-up account back through onboarding', async () => {
    localStorage.setItem('marcom:onboarded', 'false');
    at('/app/overview');
    expect(await screen.findByText('app')).toBeInTheDocument();
  });

  it('retry re-reads, and a recovered read continues into the app', async () => {
    context.get
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { httpStatus: 500 }))
      .mockResolvedValue(onboarded);
    at('/app/overview');
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(context.get).toHaveBeenCalledTimes(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OnboardingRoute — the same four outcomes, read the other way round
// ════════════════════════════════════════════════════════════════════════════
describe('OnboardingRoute', () => {
  it('shows the wizard when setup is incomplete', async () => {
    context.get.mockResolvedValue(notOnboarded);
    at('/onboarding', 'onboarding');
    expect(await screen.findByText('onboarding-wizard')).toBeInTheDocument();
  });

  it('sends a set-up account on to the destination it was carrying', async () => {
    const { container } = at('/onboarding?next=%2Fapp%2Fmemory', 'onboarding');
    await waitFor(() => expect(container.textContent).toContain('app'));
  });

  it('refuses a destination that leaves the app', async () => {
    const { container } = at('/onboarding?next=https%3A%2F%2Fevil.example', 'onboarding');
    await waitFor(() => expect(container.textContent).toContain('app'));
    expect(window.location.href).not.toContain('evil.example');
  });

  it('an unreadable read stops here too, rather than looping with ProtectedRoute', async () => {
    context.get.mockRejectedValue(new Error('boom'));
    at('/onboarding', 'onboarding');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read');
  });
});

describe.each([
  ['ProtectedRoute', '/app/overview', undefined, 'app'],
  ['OnboardingRoute', '/onboarding', 'onboarding', 'onboarding-wizard'],
])('%s · account-context refusal and recovery', (_name, path, guard, destination) => {
  it.each([
    { httpStatus: 403, code: 'INVITATION_INVALID' },
    { response: { status: 403 } },
  ])('a 403 blocks both destinations with factual refusal copy and no retry (%j)', async (details) => {
    localStorage.setItem('marcom:onboarded', 'true');
    context.get.mockRejectedValue(Object.assign(new Error('Access denied'), details));
    at(path, guard);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your account setup cannot be accessed');
    expect(alert).toHaveTextContent('Access to account setup was refused for this session.');
    expect(alert).not.toHaveTextContent(/could not reach|service|incomplete|missing|upgrade|invitation/i);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByText('app')).not.toBeInTheDocument();
    expect(screen.queryByText('onboarding-wizard')).not.toBeInTheDocument();
    expect(context.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    { httpStatus: 503, code: 'ContextUnavailable' },
    { code: 'NETWORK_ERROR' },
  ])('transient failure remains unavailable and retry recovers the correct destination (%j)', async (details) => {
    const recovered = guard === 'onboarding' ? { data: { context: null } } : onboarded;
    context.get.mockRejectedValueOnce(Object.assign(new Error('unavailable'), details)).mockResolvedValue(recovered);
    at(path, guard);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account setup could not be read');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(destination)).toBeInTheDocument();
    expect(context.get).toHaveBeenCalledTimes(2);
  });

  it('successful context:null is setup absence, never a failure', async () => {
    context.get.mockResolvedValue({ data: { context: null } });
    at(path, guard);
    expect(await screen.findByText('onboarding-wizard')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a new valid read after remount does not inherit the old refusal', async () => {
    context.get.mockRejectedValueOnce(Object.assign(new Error('denied'), { httpStatus: 403 })).mockResolvedValue(onboarded);
    const view = at(path, guard);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account setup cannot be accessed');
    view.unmount();
    at(path, guard);
    expect(await screen.findByText('app')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(context.get).toHaveBeenCalledTimes(2);
  });

  it('an exhausted 401 preserves the existing blocking and retry boundary', async () => {
    context.get.mockRejectedValue(Object.assign(new Error('expired'), { httpStatus: 401 }));
    at(path, guard);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be read');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText('app')).not.toBeInTheDocument();
    expect(screen.queryByText('onboarding-wizard')).not.toBeInTheDocument();
  });
});

it('priming and clearing context preserve the guards’ existing successful-state behavior', async () => {
  context.get.mockReturnValue(new Promise(() => {}));
  at('/app/overview');
  expect(await screen.findByRole('status')).toHaveTextContent('Checking your account');
  act(() => primeContextCache({ name: 'Acme' }));
  expect(await screen.findByText('app')).toBeInTheDocument();
  act(() => clearContextCache());
  expect(await screen.findByText('onboarding-wizard')).toBeInTheDocument();
});
