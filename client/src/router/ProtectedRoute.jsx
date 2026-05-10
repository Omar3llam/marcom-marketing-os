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
  console.log('[isOnboarded] input:', context);

  if (!context || typeof context !== 'object') {
    console.log('[isOnboarded] → false (invalid type)');
    return false;
  }

  const companyName = context.companyName;

  if (typeof companyName !== 'string') {
    console.log('[isOnboarded] → false (companyName not a string)');
    return false;
  }

  const trimmed = companyName.trim();
  const result = trimmed.length > 0;

  console.log('[isOnboarded] companyName:', JSON.stringify(companyName), '→', result);

  return result;
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
  // CRITICAL: Always start pessimistic (loading:true, hasContext:false).
  // localStorage and _cached can contain stale data from:
  //   - Previous user sessions (if logout didn't clear cache)
  //   - Incomplete onboarding attempts
  //   - API responses that haven't been revalidated
  //
  // The API is the ONLY source of truth. We show a loader until the API
  // confirms the current user's onboarding state.
  const [state, setState] = useState({
    loading: true,
    hasContext: false,
  });

  console.log('[useUserContext] initial state:', state);
  console.log('[useUserContext] _cached:', _cached);
  console.log('[useUserContext] localStorage:', getStoredOnboardingState());

  useEffect(() => {
    // Subscribe to cache updates (clearContextCache, primeContextCache, etc.)
    const listener = (newState) => {
      console.log('[useUserContext] cache update received:', newState);
      setState(newState);
    };
    _subs.add(listener);
    return () => { _subs.delete(listener); };
  }, []);

  useEffect(() => {
    console.log('[useUserContext] effect fired', { authLoading, currentUser: !!currentUser });

    if (authLoading) return;   // Firebase still initialising

    if (!currentUser) {
      console.log('[useUserContext] no user — publishing false');
      publish({ loading: false, hasContext: false });
      return;
    }

    // ── CRITICAL FIX: Always call the API ─────────────────────
    // The previous implementation had an early return here that reused
    // _cached if it existed. This caused a SEVERE bug:
    //
    //   1. User A completes onboarding
    //   2. _cached = { loading: false, hasContext: true }
    //   3. User A logs out (cache not cleared properly)
    //   4. User B logs in (new user, not onboarded)
    //   5. This effect runs, sees _cached exists, and returns early
    //   6. API is NEVER called for User B
    //   7. User B bypasses onboarding
    //
    // FIX: ALWAYS call the API for the current user. The backend is the
    // authoritative source. We cannot trust module-level cache across
    // auth state changes.

    console.log('[useUserContext] calling API for current user...');
    publish({ loading: true, hasContext: false });

    let cancelled = false;
    api.get('/api/campaigns/me/context')
      .then((res) => {
        if (cancelled) return;

        console.log('[guard] API response:', res.data);

        // Normalize the response — backend may return various shapes
        const context = res?.data?.context ?? null;

        console.log('[guard] normalized context:', context);

        const hasContext = isOnboarded(context);

        console.log('[guard] strict onboard result:', hasContext);

        // Sync localStorage with the real answer from the DB
        setStoredOnboardingState(hasContext);

        publish({ loading: false, hasContext });
      })
      .catch((err) => {
        if (cancelled) return;

        console.error('[guard] API failed:', err);

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
  console.log('[clearContextCache] clearing all onboarding state');

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }

  // Explicitly reset module-level cache to force a fresh API call on next mount
  _cached = null;

  // Publish a definitive "not onboarded" state to all subscribers
  publish({
    loading: false,
    hasContext: false,
  });
}

export function ProtectedRoute({ children }) {
  const { currentUser, loading: authLoading } = useAuth();
  const { loading, hasContext }  = useUserContext();

  console.log('[ProtectedRoute]', {
    authLoading,
    loading,
    hasContext,
    currentUser: !!currentUser,
  });

  if (authLoading || loading) {
    console.log('[ProtectedRoute] showing loader');
    return <FullscreenLoader label="Restoring your session…" />;
  }

  if (!currentUser) {
    console.log('[ProtectedRoute] no user → /login');
    return <Navigate to="/login" replace />;
  }

  if (!hasContext) {
    console.log('[ProtectedRoute] not onboarded → /onboarding');
    return <Navigate to="/onboarding" replace />;
  }

  console.log('[ProtectedRoute] ✅ rendering protected content');
  return children;
}

export function OnboardingRoute({ children }) {
  const { currentUser, loading: authLoading } = useAuth();
  const { loading, hasContext }  = useUserContext();

  console.log('[OnboardingRoute]', {
    authLoading,
    loading,
    hasContext,
    currentUser: !!currentUser,
  });

  if (authLoading || loading) {
    console.log('[OnboardingRoute] showing loader');
    return <FullscreenLoader label="Checking your account…" />;
  }

  if (!currentUser) {
    console.log('[OnboardingRoute] no user → /login');
    return <Navigate to="/login" replace />;
  }

  if (hasContext) {
    console.log('[OnboardingRoute] already onboarded → /app');
    return <Navigate to="/app" replace />;
  }

  console.log('[OnboardingRoute] ✅ rendering onboarding wizard');
  return children;
}
