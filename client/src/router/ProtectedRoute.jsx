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

// ── Shared cache + onboarded predicate ─────────────────────
// Strict check: a context is only "complete" once the wizard's
// required field (companyName) is populated. An empty {} object
// does NOT count as onboarded, even though it's truthy in JS.
function isOnboarded(context) {
  return Boolean(context && typeof context === 'object' && context.companyName);
}

// Module-level cache so route flips between /app and /onboarding
// don't trigger a refetch storm. Three states:
//   null            → never fetched, useEffect will fetch
//   { loading:true} → fetch in flight
//   { hasContext}   → resolved (true OR false)
let _cached = null;
const _subs  = new Set();   // listeners for live cache updates

function publish(next) {
  _cached = next;
  // null means "invalidated — next mount will refetch". Subscribers
  // get a transient loading state so the UI doesn't flash an empty
  // object into a route guard.
  const broadcast = next ?? { loading: true, hasContext: false };
  _subs.forEach((fn) => fn(broadcast));
}

function useUserContext() {
  const { isSignedIn, isLoaded } = useAuth();
  const [state, setState] = useState(_cached || { loading: true, hasContext: false });

  useEffect(() => {
    // Re-render whenever the cache is updated by ANY subscriber
    // (incl. clearContextCache / primeContextCache from elsewhere).
    _subs.add(setState);
    return () => { _subs.delete(setState); };
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      publish({ loading: false, hasContext: false });
      return;
    }
    if (_cached && !_cached.loading) {
      // Already resolved → just sync local state.
      setState(_cached);
      return;
    }
    let cancelled = false;
    publish({ loading: true, hasContext: _cached?.hasContext ?? false });
    api.get('/api/campaigns/me/context')
      .then((res) => {
        if (cancelled) return;
        publish({ loading: false, hasContext: isOnboarded(res.data?.context) });
      })
      .catch(() => {
        if (cancelled) return;
        publish({ loading: false, hasContext: false });
      });
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn]);

  return state;
}

// Prime the cache directly from a PUT response — eliminates the
// race where navigate('/app') fires a refetch before the new
// context is visible to the route guard.
export function primeContextCache(context) {
  publish({ loading: false, hasContext: isOnboarded(context) });
}

export function clearContextCache() {
  publish(null);
}

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
