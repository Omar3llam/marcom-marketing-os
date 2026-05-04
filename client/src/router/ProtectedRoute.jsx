// ============================================================
// MARCOM / Lumi — Route guards
// ------------------------------------------------------------
// ProtectedRoute  — requires Firebase session AND a saved user context.
// OnboardingRoute — requires Firebase session, blocks if context already set.
// ============================================================
import { useEffect, useState } from 'react';
import { Navigate }            from 'react-router-dom';
import { useAuth }             from '../context/AuthContext.jsx';
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

// ── LocalStorage persistence ────────────────────────────────
const STORAGE_KEY = 'marcom:onboarded';

function getStoredOnboardingState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function setStoredOnboardingState(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Ignore storage errors
  }
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
  // Sync to localStorage when we have a definitive answer
  if (next && !next.loading) {
    setStoredOnboardingState(next.hasContext);
  }
  // null means "invalidated — next mount will refetch". Subscribers
  // get a transient loading state so the UI doesn't flash an empty
  // object into a route guard.
  const broadcast = next ?? { loading: true, hasContext: false };
  _subs.forEach((fn) => fn(broadcast));
}

function useUserContext() {
  const { currentUser, loading: authLoading } = useAuth();

  // Initialize from localStorage if available to prevent onboarding redirect on refresh
  const storedState = getStoredOnboardingState();
  const initialState = _cached || (storedState !== null
    ? { loading: false, hasContext: storedState }
    : { loading: true, hasContext: false });

  const [state, setState] = useState(initialState);

  useEffect(() => {
    // Re-render whenever the cache is updated by ANY subscriber
    // (incl. clearContextCache / primeContextCache from elsewhere).
    _subs.add(setState);
    return () => { _subs.delete(setState); };
  }, []);

  useEffect(() => {
    if (authLoading) {
      // Firebase auth is still initializing
      return;
    }

    if (!currentUser) {
      publish({ loading: false, hasContext: false });
      return;
    }

    if (_cached && !_cached.loading) {
      // Already resolved → just sync local state.
      setState(_cached);
      return;
    }

    // If we have a stored state, use it as the initial value
    // and skip the API call unless explicitly invalidated
    const stored = getStoredOnboardingState();
    if (stored !== null && !_cached) {
      publish({ loading: false, hasContext: stored });
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
  }, [authLoading, currentUser]);

  return state;
}

// Prime the cache directly from a PUT response — eliminates the
// race where navigate('/app') fires a refetch before the new
// context is visible to the route guard.
export function primeContextCache(context) {
  const hasContext = isOnboarded(context);
  setStoredOnboardingState(hasContext);
  publish({ loading: false, hasContext });
}

export function clearContextCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
  publish(null);
}

export function ProtectedRoute({ children }) {
  const { currentUser, loading: authLoading } = useAuth();
  const { loading, hasContext }  = useUserContext();

  if (authLoading || loading) return <FullscreenLoader label="Restoring your session…" />;
  if (!currentUser)           return <Navigate to="/login" replace />;
  if (!hasContext)            return <Navigate to="/onboarding" replace />;
  return children;
}

export function OnboardingRoute({ children }) {
  const { currentUser, loading: authLoading } = useAuth();
  const { loading, hasContext }  = useUserContext();

  if (authLoading || loading) return <FullscreenLoader label="Checking your account…" />;
  if (!currentUser)           return <Navigate to="/login" replace />;
  if (hasContext)             return <Navigate to="/app" replace />;
  return children;
}
