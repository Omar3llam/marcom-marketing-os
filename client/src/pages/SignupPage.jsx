// ============================================================
// MARCOM / Lumi — SignupPage
// ------------------------------------------------------------
// Decision A2: thin Clerk SignUp wrapper. After successful sign-up
// Clerk forwards to /onboarding, where we collect the brand context.
// ============================================================
import { SignUp, SignedIn, SignedOut } from '@clerk/clerk-react';
import { Navigate, Link } from 'react-router-dom';
import { Sparkles }       from 'lucide-react';

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <SignedIn>
        {/* If a session already exists, send them straight to onboarding —
            ProtectedRoute will then forward to /app if context is set. */}
        <Navigate to="/onboarding" replace />
      </SignedIn>
      <SignedOut>
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <div className="mb-3 inline-flex items-center gap-2 text-white">
              <Sparkles className="h-5 w-5 text-yellow-400" />
              <span className="font-bold tracking-widest uppercase">Lumi · Decision OS</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Create your workspace</h1>
            <p className="mt-1 text-sm text-gray-400">
              Three minutes to your first AI-driven decision feed.
            </p>
          </div>

          <SignUp
            routing="path"
            path="/signup"
            signInUrl="/login"
            afterSignUpUrl="/onboarding"
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
            Already have an account?{' '}
            <Link to="/login" className="text-blue-400 hover:text-blue-300">Sign in</Link>
          </p>
        </div>
      </SignedOut>
    </div>
  );
}
