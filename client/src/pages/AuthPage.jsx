// ============================================================
// MARCOM / Lumi — Firebase Auth Page (Login/Signup)
// ------------------------------------------------------------
// Modern Tailwind UI with Email/Password and Google Sign-in.
// Replace the old AuthPage.jsx with this file.
// ============================================================
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { toast } from 'sonner';
import { Sparkles, Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { MetricValue, DecisionTitle } from '@/components/primitives';

export default function AuthPage({ mode: defaultMode = 'login' }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();

  const [mode, setMode] = useState(searchParams.get('mode') || defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isLogin = mode === 'login';

  const handleGoogleSignIn = async () => {
    setError(null);
    setBusy(true);

    // 15-second safety timeout: if the popup is closed without completing,
    // or auth silently fails (e.g. redirect flow stalls), reset the UI
    // so the buttons don't stay frozen indefinitely.
    const timeout = setTimeout(() => {
      setBusy(false);
      setError('Sign in is taking too long. Please try again.');
    }, 15_000);

    try {
      await signInWithGoogle();
      clearTimeout(timeout);
      toast.success('Signed in with Google!');
      navigate('/onboarding');
    } catch (err) {
      clearTimeout(timeout);
      setBusy(false);
      // Suppress "popup closed by user" — that's intentional, not an error
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        return;
      }
      const msg = err.message || 'Google sign-in failed';
      setError(msg);
      toast.error(msg);
    }
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setError(null);

    console.log('[AuthPage] Form submitted', {
      mode: isLogin ? 'login' : 'signup',
      email,
      emailLength: email?.length,
      passwordLength: password?.length,
      hasEmail: !!email,
      hasPassword: !!password,
    });

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setBusy(true);
    try {
      if (isLogin) {
        await signInWithEmail(email, password);
        toast.success('Signed in successfully!');
      } else {
        console.log('[AuthPage] Calling signUpWithEmail');
        await signUpWithEmail(email, password);
        toast.success('Account created! Welcome aboard.');
      }
      navigate('/onboarding');
    } catch (err) {
      console.error('[AuthPage] Auth error:', err);
      let msg = 'Authentication failed';

      // Firebase error codes
      if (err.code === 'auth/email-already-in-use') {
        msg = 'Email already in use. Try logging in instead.';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'Invalid email address';
      } else if (err.code === 'auth/user-not-found') {
        msg = 'No account found with this email';
      } else if (err.code === 'auth/wrong-password') {
        msg = 'Incorrect password';
      } else if (err.code === 'auth/weak-password') {
        msg = 'Password is too weak. Use at least 6 characters.';
      } else if (err.message) {
        msg = err.message;
      }

      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-light flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-dark-base mb-3">
            <Sparkles className="h-6 w-6 text-lumi-gold" />
            <MetricValue as="span" className="tracking-tight">Lumi</MetricValue>
          </div>
          <DecisionTitle as="h1" className="text-dark-base">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </DecisionTitle>
          <p className="mt-1 text-sm text-dark-soft">
            {isLogin ? 'Sign in to continue to your workspace' : 'Get started with your AI marketing co-pilot'}
          </p>
        </div>

        {/* Auth Card */}
        <div className="rounded-2xl border border-surface-border bg-surface-card p-6 shadow-card">
          {/* Google Sign-in */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className={cn(
              'w-full flex items-center justify-center gap-3 rounded-xl border border-surface-border',
              'bg-surface-light hover:bg-lumi-gold/5 px-4 py-3 text-sm font-medium text-dark-base',
              'transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in with Google…
              </>
            ) : (
              <>
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-surface-border" />
            <span className="text-xs text-dark-soft uppercase tracking-wider">Or</span>
            <div className="flex-1 h-px bg-surface-border" />
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-dark-soft mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-dark-soft" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  placeholder="you@company.com"
                  className={cn(
                    'w-full rounded-lg border border-surface-border bg-surface-light pl-10 pr-3 py-2.5',
                    'text-sm text-dark-base placeholder:text-dark-soft',
                    'focus:border-lumi-gold focus:outline-none focus:ring-1 focus:ring-lumi-gold',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-dark-soft mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-dark-soft" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder="••••••••"
                  className={cn(
                    'w-full rounded-lg border border-surface-border bg-surface-light pl-10 pr-3 py-2.5',
                    'text-sm text-dark-base placeholder:text-dark-soft',
                    'focus:border-lumi-gold focus:outline-none focus:ring-1 focus:ring-lumi-gold',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                />
              </div>
              {!isLogin && (
                <p className="mt-1 text-xs text-dark-soft">
                  Must be at least 6 characters
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-signal-kill/20 bg-signal-kill/5 p-3 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 text-signal-kill mt-0.5" />
                <span className="text-signal-kill">{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={busy}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-lg',
                'bg-lumi-gold hover:bg-lumi-deep px-4 py-2.5 text-sm font-semibold text-dark-base',
                'transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-card hover:shadow-gold-glow'
              )}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>

        {/* Toggle Mode */}
        <p className="mt-6 text-center text-sm text-dark-soft">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => {
              setMode(isLogin ? 'signup' : 'login');
              setError(null);
            }}
            className="font-semibold text-lumi-gold hover:text-lumi-deep transition-colors"
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-dark-soft">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
