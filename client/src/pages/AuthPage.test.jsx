// ============================================================
// AuthPage — the way back out
// ------------------------------------------------------------
// The auth page renders no nav chrome, so without an explicit link a visitor
// who lands here by mistake has only the browser Back button. It must be a
// router Link (same-app navigation): an <a href> full-reloads and drops the
// ?next= param the post-auth redirect depends on.
// ============================================================
import fs from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { contrast, localDir } from '../../design-system/foundation/resolve.js';
import colors from '../../design-system/tokens/colors.json';

const session = vi.hoisted(() => ({
  signInWithGoogle: vi.fn(), signInWithEmail: vi.fn(), signUpWithEmail: vi.fn(),
  currentUser: null, authReady: true,
}));
const browser = vi.hoisted(() => ({ embedded: false }));

vi.mock('@/context/AuthContext.jsx', () => ({
  useAuth: () => session,
}));
vi.mock('@/firebase.js', () => ({ isEmbeddedWebviewOrMobile: () => browser.embedded }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AuthPage from './AuthPage.jsx';
import { LandingPage } from '../lumi/landing/LandingPage.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  session.currentUser = null;
  session.authReady = true;
  browser.embedded = false;
});

const renderPage = () => render(<AuthPage />, { wrapper: MemoryRouter });

function Destination() {
  const location = useLocation();
  return <p>Destination: {location.pathname}{location.search}</p>;
}

const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/onboarding" element={<Destination />} />
      <Route path="/app/*" element={<Destination />} />
    </Routes>
  </MemoryRouter>,
);

describe('P8-02B-R — auth mode-switch contrast', () => {
  // Resolve the legacy utilities this existing surface actually uses; browser
  // verification separately measures their compiled default/hover styles.
  const textColors = {
    'text-lumi-gold': colors.brand.gold,
    'text-lumi-deep': colors.brand.deep,
    'text-dark-base': colors.text.base,
    'text-dark-soft': colors.text.soft,
  };

  it.each([
    ['/login', 'Sign up', 'default'], ['/login', 'Sign up', 'hover'],
    ['/signup', 'Sign in', 'default'], ['/signup', 'Sign in', 'hover'],
  ])('keeps %s switch text readable in %s / %s', (url, label, state) => {
    renderAt(url);
    const button = screen.getByRole('button', { name: label, exact: true });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.closest('.bg-surface-light')).not.toBeNull();
    const classes = [...button.classList];
    const utility = state === 'hover'
      ? classes.find(name => name.startsWith('hover:text-'))?.slice('hover:'.length)
      : classes.find(name => name.startsWith('text-'));
    expect(textColors[utility]).toBeDefined();
    expect(contrast(textColors[utility], colors.surface.light)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('P8-02B — LUMI public signup/login handoff', () => {
  it('uses the landing category on signup, without generic AI-copilot framing', () => {
    const { container } = renderAt('/signup');
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByText('Decision Intelligence for Performance Marketing')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/AI marketing co-pilot|AI[- ]powered marketing|AI (copilot|assistant|marketing platform)|chat assistant|\bmagic\b|smart AI/i);
  });

  it('removes Sparkles from source and rendered identity without a replacement AI glyph', () => {
    const { container } = renderAt('/signup');
    expect(container.querySelector('.lucide-sparkles')).toBeNull();
    const source = fs.readFileSync(`${localDir('./', import.meta.url)}AuthPage.jsx`, 'utf8');
    expect(source).not.toMatch(/\b(Sparkles|Bot|Wand|Brain|Lightbulb|Stars)\b/);
  });

  it.each(['/signup', '/login'])('keeps uppercase text identity on %s', (url) => {
    const { container } = renderAt(url);
    const identity = screen.getByText('LUMI', { exact: true });
    expect(identity.parentElement.querySelector('svg')).toBeNull();
    expect(container.textContent).not.toMatch(/MARCOM|AI Marketing Co-pilot/);
  });

  it('preserves login heading and workspace support copy', () => {
    renderAt('/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to continue to your workspace')).toBeInTheDocument();
    expect(screen.queryByText('Decision Intelligence for Performance Marketing')).toBeNull();
  });

  it('updates messaging and form mode in both toggle directions', () => {
    renderAt('/signup');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to continue to your workspace')).toBeInTheDocument();
    expect(screen.queryByText('Decision Intelligence for Performance Marketing')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toHaveAttribute('type', 'submit');
    fireEvent.click(screen.getByRole('button', { name: 'Sign up', exact: true }));
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByText('Decision Intelligence for Performance Marketing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveAttribute('type', 'submit');
  });

  it('carries the category from landing to signup and returns through Back to home', () => {
    renderAt('/');
    const category = screen.getByText('Decision Intelligence for Performance Marketing').textContent;
    fireEvent.click(screen.getAllByRole('link', { name: 'Create an account', exact: true })[0]);
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByText(category)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Back to home' }));
    expect(screen.getByRole('heading', { name: 'Verdicts. Not dashboards.' })).toBeInTheDocument();
  });

  it('keeps Google authentication and its valid next destination', async () => {
    renderAt('/signup?next=%2Fapp%2Fmemory%3Ffilter%3Drecent');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(session.signInWithGoogle).toHaveBeenCalledOnce());
    expect(await screen.findByText('Destination: /app/memory?filter=recent')).toBeInTheDocument();
    expect(session.signUpWithEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['/login?next=%2Fapp%2Fdecisions', 'Sign in', 'signInWithEmail', '/app/decisions'],
    ['/signup', 'Create account', 'signUpWithEmail', '/onboarding'],
  ])('preserves email submission and destination from %s', async (url, label, method, destination) => {
    renderAt(url);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-only-password' } });
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    await waitFor(() => expect(session[method]).toHaveBeenCalledWith('test@example.test', 'test-only-password'));
    expect(await screen.findByText(`Destination: ${destination}`)).toBeInTheDocument();
  });

  it('preserves embedded-browser refusal copy without navigating or sending real auth', async () => {
    browser.embedded = true;
    session.signInWithGoogle.mockRejectedValueOnce({ message: 'disallowed_useragent' });
    renderAt('/signup');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByText('Open in your browser')).toBeInTheDocument();
    expect(screen.getByText('Sign in blocked by Google. Please open this page in your default browser (Safari, Chrome).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.queryByText(/Destination:/)).toBeNull();
  });
});

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
