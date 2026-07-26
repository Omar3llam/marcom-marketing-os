// ============================================================
// AuthPage — the way back out
// ------------------------------------------------------------
// The auth page renders no nav chrome, so without an explicit link a visitor
// who lands here by mistake has only the browser Back button. It must be a
// router Link (same-app navigation): an <a href> full-reloads and drops the
// ?next= param the post-auth redirect depends on.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext.jsx', () => ({
  useAuth: () => ({
    signInWithGoogle: vi.fn(), signInWithEmail: vi.fn(), signUpWithEmail: vi.fn(),
    currentUser: null, authReady: true,
  }),
}));
vi.mock('@/firebase.js', () => ({ isEmbeddedWebviewOrMobile: () => false }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/auth/GoogleSignInButton.jsx', () => ({ GoogleSignInButton: () => <button type="button">Continue with Google</button> }));
vi.mock('@/components/auth/LoginForm.jsx', () => ({ LoginForm: () => <form /> }));

import AuthPage from './AuthPage.jsx';

const renderPage = () => render(<AuthPage />, { wrapper: MemoryRouter });

describe('AuthPage — back to the landing page', () => {
  it('offers a link home so the page is not a dead end', () => {
    renderPage();
    const back = screen.getByRole('link', { name: /back to home/i });
    expect(back).toHaveAttribute('href', '/');
  });

  it('is a router Link, not a full-page reload', () => {
    renderPage();
    // A react-router Link renders a same-origin relative href and intercepts the
    // click; an external <a> would carry a protocol and reload the app.
    const back = screen.getByRole('link', { name: /back to home/i });
    expect(back.getAttribute('href')).not.toMatch(/^https?:/);
    expect(back).not.toHaveAttribute('target');
  });

  it('still renders the sign-in surface alongside it', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });
});
