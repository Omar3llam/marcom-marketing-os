// ============================================================
// MARCOM / Lumi — Route guards
// ------------------------------------------------------------
// ProtectedRoute  — requires Clerk session AND a saved user context.
// OnboardingRoute — requires Clerk session, blocks if context already set.
// ============================================================
import { useEffect, useState } from 'react';
import { Navigate }            from 'react-router-dom';
import { useAuth, useUser }    from '@clerk/clerk-react';
import { api }                 from '../lib/api.js';
import { Loader2 }             from 'lucide-react';

function FullscreenLoader({ label = 'Loading…' }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

// Shared hook: returns { loading, hasContext } based on the
// /api/campaigns/me/context probe. Cached so route changes don't
// re-fetch on every navigation.
let _cached = null;
function useUserContext() {
  const { isSignedIn, isLoaded } = useAuth();
  const [state, setState] = useState(_cached || { loading: true, hasContext: false });

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setState({ loading: false, hasContext: false });
      return;
    }
    if (_cached) {
      setState(_cached);
      return;
    }
    let cancelled = false;
    api.get('/api/campaigns/me/context')
      .then((res) => {
        const next = { loading: false, hasContext: Boolean(res.data?.context) };
        _cached = next;
        if (!cancelled) setState(next);
      })
      .catch(() => {
        const next = { loading: false, hasContext: false };
        _cached = next;
        if (!cancelled) setState(next);
      });
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn]);

  return state;
}

export function clearContextCache() { _cached = null; }

export function ProtectedRoute({ children }) {
  const { isSignedIn, isLoaded } = useAuth();
  const { loading, hasContext }  = useUserContext();

  if (!isLoaded || loading) return <FullscreenLoader label="Restoring your session…" />;
  if (!isSignedIn)          return <Navigate to="/login" replace />;
  if (!hasContext)          return <Navigate to="/onboarding" replace />;
  return children;
}

export function OnboardingRoute({ children }) {
  const { isSignedIn, isLoaded } = useAuth();
  const { loading, hasContext }  = useUserContext();

  if (!isLoaded || loading) return <FullscreenLoader label="Checking your account…" />;
  if (!isSignedIn)          return <Navigate to="/login" replace />;
  if (hasContext)           return <Navigate to="/app" replace />;
  return children;
}
