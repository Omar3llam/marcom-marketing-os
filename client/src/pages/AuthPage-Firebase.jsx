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
    try {
      await signInWithGoogle();
      toast.success('Signed in with Google!');
      navigate('/onboarding');
    } catch (err) {
      const msg = err.message || 'Google sign-in failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setError(null);

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
        await signUpWithEmail(email, password);
        toast.success('Account created! Welcome aboard.');
      }
      navigate('/onboarding');
    } catch (err) {
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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-white mb-3">
            <Sparkles className="h-6 w-6 text-yellow-400" />
            <span className="font-bold text-2xl tracking-tight">Lumi</span>
          </div>
          <h1 className="text-xl font-semibold text-white">
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            {isLogin ? 'Sign in to continue to your workspace' : 'Get started with your AI marketing co-pilot'}
          </p>
        </div>

        {/* Auth Card */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 backdrop-blur-sm">
          {/* Google Sign-in */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className={cn(
              'w-full flex items-center justify-center gap-3 rounded-xl border border-gray-700',
              'bg-white/5 hover:bg-white/10 px-4 py-3 text-sm font-medium text-white',
              'transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            )}
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-gray-800" />
            <span className="text-xs text-gray-500 uppercase tracking-wider">Or</span>
            <div className="flex-1 h-px bg-gray-800" />
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-gray-400 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  placeholder="you@company.com"
                  className={cn(
                    'w-full rounded-lg border border-gray-700 bg-gray-800/60 pl-10 pr-3 py-2.5',
                    'text-sm text-white placeholder:text-gray-500',
                    'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-gray-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder="••••••••"
                  className={cn(
                    'w-full rounded-lg border border-gray-700 bg-gray-800/60 pl-10 pr-3 py-2.5',
                    'text-sm text-white placeholder:text-gray-500',
                    'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                />
              </div>
              {!isLogin && (
                <p className="mt-1 text-xs text-gray-500">
                  Must be at least 6 characters
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <span className="text-red-200">{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={busy}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-lg',
                'bg-blue-600 hover:bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white',
                'transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>

        {/* Toggle Mode */}
        <p className="mt-6 text-center text-sm text-gray-400">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => {
              setMode(isLogin ? 'signup' : 'login');
              setError(null);
            }}
            className="font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-gray-600">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
