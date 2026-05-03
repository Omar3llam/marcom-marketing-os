// ============================================================
// MARCOM / Lumi — AuthPage  (mode='login' | 'signup')
// ------------------------------------------------------------
// Consolidates the previous LoginPage + SignupPage into a single
// component driven by the `mode` prop, per the design-system
// route spec. Wraps Clerk's hosted SignIn / SignUp components.
// ============================================================
import { SignIn, SignUp, SignedIn, SignedOut } from '@clerk/clerk-react';
import { Navigate, Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

const clerkAppearance = {
  elements: {
    rootBox:           'w-full',
    card:              'bg-lumi-surface border border-lumi-border shadow-panel',
    headerTitle:       'text-lumi-text font-display',
    headerSubtitle:    'text-lumi-muted',
    socialButtonsBlockButton: 'border-lumi-border text-lumi-text hover:bg-lumi-elevated',
    formFieldLabel:    'text-lumi-muted',
    formFieldInput:    'bg-lumi-elevated border-lumi-border text-lumi-text',
    formButtonPrimary: 'bg-lumi-accent text-lumi-bg hover:bg-lumi-accent-hover',
    footerActionLink:  'text-lumi-accent hover:text-lumi-accent-hover',
    dividerLine:       'bg-lumi-border',
    dividerText:       'text-lumi-subtle',
  },
};

export default function AuthPage({ mode = 'login' }) {
  const isSignup = mode === 'signup';

  return (
    <div className="flex min-h-screen items-center justify-center bg-lumi-bg p-4">
      <SignedIn>
        <Navigate to={isSignup ? '/onboarding' : '/app/feed'} replace />
      </SignedIn>

      <SignedOut>
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mb-3 inline-flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-lumi-accent" strokeWidth={1.5} />
              <span className="font-display font-bold tracking-widest uppercase text-lumi-accent">
                Lumi · Decision OS
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold text-lumi-text">
              {isSignup ? 'Create your workspace' : 'Welcome back'}
            </h1>
            <p className="mt-1 text-sm text-lumi-muted">
              {isSignup
                ? 'Three minutes to your first AI-driven decision feed.'
                : 'Sign in to your workspace.'}
            </p>
          </div>

          {isSignup ? (
            <SignUp
              routing="path"
              path="/signup"
              signInUrl="/login"
              afterSignUpUrl="/onboarding"
              appearance={clerkAppearance}
            />
          ) : (
            <SignIn
              routing="path"
              path="/login"
              signUpUrl="/signup"
              afterSignInUrl="/app/feed"
              appearance={clerkAppearance}
            />
          )}

          <p className="mt-4 text-center text-xs text-lumi-subtle">
            {isSignup ? (
              <>Already have an account? <Link to="/login" className="text-lumi-accent hover:text-lumi-accent-hover">Sign in</Link></>
            ) : (
              <>New here? <Link to="/signup" className="text-lumi-accent hover:text-lumi-accent-hover">Create an account</Link></>
            )}
          </p>
        </div>
      </SignedOut>
    </div>
  );
}
