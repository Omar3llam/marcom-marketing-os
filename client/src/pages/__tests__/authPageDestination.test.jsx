// ============================================================
// Phase 5.2 — the login page restores the destination the guard preserved
// ------------------------------------------------------------
// The guards and this page are two halves of one promise: a guard writes
// ?next=, this page reads it. They used to disagree — the guards preserved
// /admin and /onboarding, and this page's own validator accepted /app paths
// ONLY, so those two were silently replaced by the onboarding default. Both
// halves now read the same validator, and this file holds that seam.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const session = vi.hoisted(() => ({
  signInWithGoogle: vi.fn(), signInWithEmail: vi.fn(), signUpWithEmail: vi.fn(),
  currentUser: null, authReady: true,
}));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => session }));
vi.mock('@/firebase.js', () => ({ isEmbeddedWebviewOrMobile: () => false }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/auth/GoogleSignInButton.jsx', () => ({ GoogleSignInButton: () => <button type="button">Continue with Google</button> }));
vi.mock('@/components/auth/LoginForm.jsx', () => ({ LoginForm: () => <form /> }));

const AuthPage = (await import('../AuthPage.jsx')).default;

/** Renders the login page at `url`, with a sentinel for every landing place. */
const at = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/app/*" element={<div>app</div>} />
      <Route path="/onboarding" element={<div>onboarding-wizard</div>} />
      <Route path="/admin" element={<div>admin-panel</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  session.currentUser = null;
  session.authReady = true;
});

describe('AuthPage · where a signed-in visitor is sent', () => {
  beforeEach(() => { session.currentUser = { uid: 'u1' }; });

  it.each([
    ['/login?next=%2Fapp%2Fdecisions%2F123', 'app'],
    ['/login?next=%2Fapp%2Fmemory%3Ffilter%3Drecent', 'app'],
    ['/login?next=%2Fadmin', 'admin-panel'],
    ['/login?next=%2Fonboarding', 'onboarding-wizard'],
  ])('%s → %s', async (url, sentinel) => {
    at(url);
    expect(await screen.findByText(sentinel)).toBeInTheDocument();
  });

  it('falls back to onboarding when no destination was carried', async () => {
    at('/login');
    expect(await screen.findByText('onboarding-wizard')).toBeInTheDocument();
  });

  it('refuses a destination that would leave the app', async () => {
    at('/login?next=https%3A%2F%2Fevil.example%2Fapp');
    expect(await screen.findByText('onboarding-wizard')).toBeInTheDocument();
  });

  it('refuses a destination that points back at the auth pages', async () => {
    at('/login?next=%2Flogin');
    expect(await screen.findByText('onboarding-wizard')).toBeInTheDocument();
  });
});

describe('AuthPage · while the session is unresolved', () => {
  it('holds the form rather than flashing a sign-in page at someone already signed in', () => {
    session.authReady = false;
    session.currentUser = { uid: 'u1' };
    at('/login?next=%2Fapp%2Foverview');
    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session…');
    expect(screen.queryByText(/Continue with Google/)).toBeNull();
  });

  it('shows the form once Firebase answers with no session', async () => {
    session.authReady = true;
    session.currentUser = null;
    at('/login');
    expect(await screen.findByText('Continue with Google')).toBeInTheDocument();
  });
});
