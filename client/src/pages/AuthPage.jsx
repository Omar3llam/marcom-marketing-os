import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { toast } from 'sonner';
import { AlertCircle, ExternalLink, ArrowLeft } from 'lucide-react';
import { MetricValue, DecisionTitle } from '@/components/primitives';
import { isEmbeddedWebviewOrMobile } from '@/firebase.js';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton.jsx';
import { LoginForm } from '@/components/auth/LoginForm.jsx';
import { safeNextPath } from '@/router/nextPath.js';
import { FullscreenLoader } from '@/router/ProtectedRoute.jsx';

export default function AuthPage({ mode: defaultMode = 'login' }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, currentUser, authReady } = useAuth();
  // Phase 5.2 — one shared validator, so every destination a guard preserves is
  // one this page can restore. The local copy here accepted /app paths ONLY,
  // which is why /admin and /onboarding lost their destination at login.
  const nextPath = safeNextPath(searchParams.get('next'));
  const postAuthPath = nextPath || '/onboarding';

  const [mode, setMode] = useState(searchParams.get('mode') || defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showEmbeddedWarning, setShowEmbeddedWarning] = useState(false);

  // Navigate once Firebase resolves an authenticated user. Guards both popup
  // and redirect flows where auth state arrives after this component mounts.
  useEffect(() => {
    if (currentUser && authReady) navigate(postAuthPath, { replace: true });
  }, [currentUser, authReady, navigate, postAuthPath]);

  // Hold the form until Firebase has answered: this page DOES depend on the
  // session (it redirects an already-signed-in visitor), unlike the landing.
  // Rendering a sign-in form at someone who is already signed in is the flash
  // this prevents.
  if (!authReady) return <FullscreenLoader label="Restoring your session…" />;

  const isLogin = mode === 'login';
  const inEmbeddedBrowser = isEmbeddedWebviewOrMobile();

  const handleGoogleSignIn = async () => {
    setError(null);
    setShowEmbeddedWarning(false);
    setBusy(true);

    // 15-second safety timeout: resets UI if popup stalls (redirect flow excluded).
    const timeout = setTimeout(() => {
      if (!inEmbeddedBrowser) {
        setBusy(false);
        setError('Sign in is taking too long. Please try again.');
      }
    }, 15_000);

    try {
      await signInWithGoogle();
      clearTimeout(timeout);
      if (!inEmbeddedBrowser) {
        toast.success('Signed in with Google!');
        navigate(postAuthPath, { replace: true });
      }
    } catch (err) {
      clearTimeout(timeout);
      setBusy(false);
      console.error('[AuthPage] Google sign-in error:', err);
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
      let msg = 'Google sign-in failed';
      if (err.code === 'auth/operation-not-allowed') msg = 'Google sign-in is not enabled. Please contact support.';
      else if (err.code === 'auth/unauthorized-domain') msg = 'This domain is not authorized for Google sign-in. Please contact support.';
      else if (err.code === 'auth/network-request-failed') msg = 'Network error. Please check your connection and try again.';
      else if (err.message?.includes('disallowed_useragent') || err.message?.includes('Error 403')) {
        msg = 'Sign in blocked by Google. Please open this page in your default browser (Safari, Chrome).';
        setShowEmbeddedWarning(true);
      } else if (err.message) msg = err.message;
      setError(msg);
      toast.error(msg);
    }
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) { setError('Email and password are required'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setBusy(true);
    try {
      if (isLogin) {
        await signInWithEmail(email, password);
        toast.success('Signed in successfully!');
      } else {
        await signUpWithEmail(email, password);
        toast.success('Account created! Welcome aboard.');
      }
      navigate(postAuthPath, { replace: true });
    } catch (err) {
      console.error('[AuthPage] Auth error:', err);
      let msg = 'Authentication failed';
      if (err.code === 'auth/email-already-in-use') msg = 'Email already in use. Try logging in instead.';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid email address';
      else if (err.code === 'auth/user-not-found') msg = 'No account found with this email';
      else if (err.code === 'auth/wrong-password') msg = 'Incorrect password';
      else if (err.code === 'auth/weak-password') msg = 'Password is too weak. Use at least 6 characters.';
      else if (err.message) msg = err.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-light flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* The auth page is a dead end otherwise — there is no nav chrome here,
            so a visitor who lands on it by mistake has only the browser Back
            button. A router Link, not an <a>: this is same-app navigation and a
            full reload would drop the ?next= param the post-auth redirect uses. */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 mb-6 text-sm text-dark-soft hover:text-dark-base transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          Back to home
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-dark-base mb-3">
            <MetricValue as="span" className="tracking-tight">LUMI</MetricValue>
          </div>
          <DecisionTitle as="h1" className="text-dark-base">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </DecisionTitle>
          <p className="mt-1 text-sm text-dark-soft">
            {isLogin ? 'Sign in to continue to your workspace' : 'Decision Intelligence for Performance Marketing'}
          </p>
        </div>

        {showEmbeddedWarning && (
          <div className="mb-4 rounded-xl border border-lumi-gold/30 bg-lumi-gold/5 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-lumi-gold mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-dark-base mb-1">Open in your browser</p>
                <p className="text-dark-soft mb-3">
                  You&apos;re viewing this in an embedded browser (like Facebook Messenger).
                  Google blocks sign-in here for security. Please open this page in Safari, Chrome, or your default browser.
                </p>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(window.location.href); toast.success('Link copied! Paste it in your browser.'); }}
                  className="inline-flex items-center gap-2 text-sm font-medium text-lumi-gold hover:text-lumi-deep transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  Copy link
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-surface-border bg-surface-card p-6 shadow-card">
          <GoogleSignInButton busy={busy} onClick={handleGoogleSignIn} />
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-surface-border" />
            <span className="text-xs text-dark-soft uppercase tracking-wider">Or</span>
            <div className="flex-1 h-px bg-surface-border" />
          </div>
          <LoginForm
            isLogin={isLogin}
            email={email}
            password={password}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            busy={busy}
            error={error}
            onSubmit={handleEmailAuth}
          />
        </div>

        <p className="mt-6 text-center text-sm text-dark-soft">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => { setMode(isLogin ? 'signup' : 'login'); setError(null); }}
            className="font-semibold text-lumi-gold hover:text-lumi-deep transition-colors"
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>

        <p className="mt-8 text-center text-xs text-dark-soft">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
