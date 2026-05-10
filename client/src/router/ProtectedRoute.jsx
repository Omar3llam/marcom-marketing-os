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

  // ── Initial state ─────────────────────────────────────────
  // Always start with loading:true on fresh page load (_cached is null).
  // If _cached is populated from a previous in-session API call, reuse it
  // so we don't flash a spinner on every route transition.
  //
  // IMPORTANT: when _cached is null we must NOT set loading:false here,
  // even if localStorage says true. A loading:false/hasContext:true initial
  // state causes ProtectedRoute to render children (the app) synchronously,
  // BEFORE the API verifies the Prisma row exists — bypassing onboarding.
  const [state, setState] = useState(
    _cached || { loading: true, hasContext: getStoredOnboardingState() ?? false },
  );

  useEffect(() => {
    // Subscribe to cache updates (clearContextCache, primeContextCache, etc.)
    _subs.add(setState);
    return () => { _subs.delete(setState); };
  }, []);

  useEffect(() => {
    if (authLoading) return;   // Firebase still initialising

    if (!currentUser) {
      publish({ loading: false, hasContext: false });
      return;
    }

    // In-session memory cache: populated after the first API call completes.
    // Prevents refetch storms on tab/route switches within the same session.
    // Hard refresh (F5) clears _cached (module-level), so every new page
    // load always calls the API at least once.
    if (_cached && !_cached.loading) {
      setState(_cached);
      return;
    }

    // ── Always call the API on first mount ────────────────────
    // localStorage is optimistic UI only (prevents blank screen while
    // the spinner resolves). The API is the authoritative source for
    // whether a Prisma User/Workspace row exists.
    const stored = getStoredOnboardingState();
    publish({ loading: true, hasContext: stored ?? false });

    let cancelled = false;
    api.get('/api/campaigns/me/context')
      .then((res) => {
        if (cancelled) return;
        const hasContext = isOnboarded(res.data?.context);
        // Sync localStorage with the real answer from the DB
        setStoredOnboardingState(hasContext);
        publish({ loading: false, hasContext });
      })
      .catch(() => {
        if (cancelled) return;
        // API failed — wipe stale localStorage so user goes to onboarding
        setStoredOnboardingState(false);
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
