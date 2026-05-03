// ============================================================
// MARCOM / Lumi — LoginPage
// ------------------------------------------------------------
// Per Decision A2: thin wrapper around Clerk's hosted SignIn
// component. Branded shell, dark theme, redirects to /app on
// success — the ProtectedRoute guard then forwards to /onboarding
// if no context is set yet.
// ============================================================
import { SignIn, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { Navigate, Link } from 'react-router-dom';
import { Sparkles }       from 'lucide-react';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <SignedIn>
        {/* Already authed → bounce into the protected app. */}
        <Navigate to="/app" replace />
      </SignedIn>
      <SignedOut>
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mb-3 inline-flex items-center gap-2 text-white">
              <Sparkles className="h-5 w-5 text-yellow-400" />
              <span className="font-bold tracking-widest uppercase">Lumi · Decision OS</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Welcome back</h1>
            <p className="mt-1 text-sm text-gray-400">Sign in to your workspace.</p>
          </div>

          <SignIn
            routing="path"
            path="/login"
            signUpUrl="/signup"
            afterSignInUrl="/app"
            appearance={{
              elements: {
                rootBox:         'w-full',
                card:            'bg-gray-900 border border-gray-800',
                headerTitle:     'text-white',
                headerSubtitle:  'text-gray-400',
                socialButtonsBlockButton: 'border-gray-700',
                formFieldLabel:  'text-gray-300',
                formFieldInput:  'bg-gray-800 border-gray-700 text-white',
                formButtonPrimary: 'bg-blue-600 hover:bg-blue-500',
                footerActionLink:  'text-blue-400 hover:text-blue-300',
              },
            }}
          />

          <p className="mt-4 text-center text-xs text-gray-500">
            New here?{' '}
            <Link to="/signup" className="text-blue-400 hover:text-blue-300">Create an account</Link>
          </p>
        </div>
      </SignedOut>

      {/* Fallback: nothing rendered yet — route into Clerk. */}
      <noscript><RedirectToSignIn /></noscript>
    </div>
  );
}
