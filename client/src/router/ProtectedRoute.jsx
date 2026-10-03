// ============================================================
// MARCOM / Lumi — Route guards
// ------------------------------------------------------------
// ProtectedRoute  — requires a Firebase session AND a saved user context.
// OnboardingRoute — requires a Firebase session, blocks if context is already set.
// AdminRoute      — requires a Firebase session before the ADMIN role is read.
//
// Phase 5.2 — the auth boundary owns three things, and only these:
//   1. WHO is asking (AuthContext, the single owner of session truth);
//   2. WHETHER their account setup is readable (this file, from the API);
//   3. WHERE to send them back to afterwards (./nextPath.js).
//
// ⚠️ A FAILED READ IS NOT AN ANSWER. Until Phase 5.2 a failed
// `/api/campaigns/me/context` fell back to a localStorage flag, so a network
// blip decided a route from a value written by an earlier session — and both
// possible wrong answers were bad: "skip onboarding" and "redo onboarding".
// The storage is gone. The API is the only source, and when it cannot be read
// the guard says so, offers retry for transient failures, and never guesses. Five outcomes, kept
// distinct: LOADING · onboarded · not onboarded · UNREADABLE · NOT_PERMITTED.
// ============================================================
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth }             from '../context/AuthContext.jsx';
import { api }                 from '../lib/api.js';
import { Loader2, RefreshCw }  from 'lucide-react';
import { READ, readStatusForError, isRetryableReadError } from '../design-system/states/readStatus.js';
import { loginPathFor, safeNextPath, currentDestination } from './nextPath.js';
import { parseAccountContextResponse } from './accountContextContract.js';

export function FullscreenLoader({ label = 'Loading…' }) {
  return (
    <div className="flex h-screen items-center justify-center bg-surface-dark">
      <div className="flex items-center gap-2 text-dark-soft" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

/**
 * Keep an explicit refusal separate from an unreadable setup. Do not infer an
 * invitation, role or setup diagnosis. Only retryable reads offer recovery here;
 * neither failure continues into the app or onboarding on a guess.
 */
function AccountSetupUnavailable({ onRetry, refused = false }) {
  return (
    <div className="flex h-screen items-center justify-center bg-surface-dark p-6">
      <div className="max-w-md text-center" role="alert">
        <h1 className="decision-title text-dark-base">{refused ? 'Your account setup cannot be accessed' : 'Your account setup could not be read'}</h1>
        <p className="mt-2 text-sm leading-6 text-dark-muted">
          {refused ? 'Access to account setup was refused for this session.' : (
            'Lumi could not reach the service that stores it, so it does not know whether your setup is complete. Nothing on your account has changed.'
          )}
        </p>
        {onRetry && <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-lumi-border px-4 py-2 font-display text-sm font-semibold text-dark-base transition-colors hover:bg-lumi-elevated"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
          Try again
        </button>}
      </div>
    </div>
  );
}

// ── The onboarded predicate ────────────────────────────────
// Strict: a context counts as complete only once the wizard's required field
// (name) is populated. An empty {} does NOT count, even though it is truthy.
function isOnboarded(context) {
  if (!context || typeof context !== 'object') {
    return false;
  }

  // Check both 'name' (new) and 'companyName' (legacy) for backwards compatibility
  const brandName = context.name || context.companyName;

  if (typeof brandName !== 'string') {
    return false;
  }

  return brandName.trim().length > 0;
}

// Module-level broadcast so a route flip between /app and /onboarding, or a
// sign-out, reaches every mounted guard at once. It carries the last RESOLVED
// answer only — it is never consulted when a read fails, and it is not
// persisted anywhere, so it cannot outlive the session that produced it.
const _subs = new Set();

function publish(next) {
  const broadcast = next ?? { status: READ.LOADING, hasContext: null };
  _subs.forEach((fn) => fn(broadcast));
}

function useUserContext() {
  const { currentUser, loading: authLoading } = useAuth();

  // Always start pessimistic: the API is the only source of truth, so the route
  // is held until it answers.
  const [state, setState] = useState({ status: READ.LOADING, hasContext: null });
  // Bumped by retry(); the fetch effect depends on it, so a retry re-reads.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const listener = (newState) => setState(newState);
    _subs.add(listener);
    return () => { _subs.delete(listener); };
  }, []);

  useEffect(() => {
    if (authLoading) return;   // Firebase still initialising

    if (!currentUser) {
      // Not signed in: there is no protected status to ask for, and asking
      // would 401. A resolved answer, not a failure.
      publish({ status: READ.NOTHING_FOUND, hasContext: false });
      return;
    }

    publish({ status: READ.LOADING, hasContext: null });

    let cancelled = false;
    api.get('/api/campaigns/me/context')
      .then((res) => {
        if (cancelled) return;
        const context = parseAccountContextResponse(res?.data);
        publish({ status: isOnboarded(context) ? READ.PRESENT : READ.NOTHING_FOUND, hasContext: isOnboarded(context) });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ProtectedRoute] Context API failed:', err);
        // A refusal cannot establish setup absence or a service outage.
        // Preserve the existing 401 blocking/retry boundary; api.js owns token recovery.
        publish({ status: readStatusForError(err), hasContext: null,
          canRetry: isRetryableReadError(err) || (err?.httpStatus ?? err?.response?.status) === 401 });
      });

    return () => { cancelled = true; };
  }, [authLoading, currentUser, attempt]);

  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

// Prime the guards directly from a PUT response — eliminates the race where
// navigate('/app') fires a refetch before the new context is visible.
export function primeContextCache(context) {
  publish({ status: isOnboarded(context) ? READ.PRESENT : READ.NOTHING_FOUND, hasContext: isOnboarded(context) });
}

// Called on sign-out and on "reset setup": the next mount must ask again.
export function clearContextCache() {
  publish({ status: READ.NOTHING_FOUND, hasContext: false });
}

export function ProtectedRoute({ children }) {
  const { currentUser, loading: authLoading, authReady } = useAuth();
  const { status, hasContext, canRetry, retry } = useUserContext();
  const location = useLocation();

  // Wait for Firebase to complete its initial check before redirecting.
  // Without this, OAuth callbacks briefly show currentUser=null and bounce to login.
  if (!authReady || authLoading) {
    return <FullscreenLoader label="Restoring your session…" />;
  }

  if (!currentUser) {
    return <Navigate to={loginPathFor(location)} replace />;
  }

  if (status === READ.LOADING) {
    return <FullscreenLoader label="Checking your account…" />;
  }

  if (status === READ.NOT_PERMITTED || status === READ.NOT_REACHABLE) {
    return <AccountSetupUnavailable refused={status === READ.NOT_PERMITTED} onRetry={canRetry && status !== READ.NOT_PERMITTED ? retry : undefined} />;
  }

  if (!hasContext) {
    const next = safeNextPath(currentDestination(location));
    return <Navigate to={next ? `/onboarding?next=${encodeURIComponent(next)}` : '/onboarding'} replace />;
  }

  return children;
}

export function OnboardingRoute({ children }) {
  const { currentUser, loading: authLoading, authReady } = useAuth();
  const { status, hasContext, canRetry, retry } = useUserContext();
  const location = useLocation();
  const nextPath = safeNextPath(new URLSearchParams(location.search).get('next'));

  if (!authReady || authLoading) {
    return <FullscreenLoader label="Checking your account…" />;
  }

  if (!currentUser) {
    // Keeps the whole address, so a deep link through onboarding survives login.
    return <Navigate to={loginPathFor(location)} replace />;
  }

  if (status === READ.LOADING) {
    return <FullscreenLoader label="Checking your account…" />;
  }

  if (status === READ.NOT_PERMITTED || status === READ.NOT_REACHABLE) {
    return <AccountSetupUnavailable refused={status === READ.NOT_PERMITTED} onRetry={canRetry && status !== READ.NOT_PERMITTED ? retry : undefined} />;
  }

  if (hasContext) {
    return <Navigate to={nextPath || '/app'} replace />;
  }

  return children;
}

/**
 * /admin lives OUTSIDE the /app shell, so it had no session guard of its own:
 * an unauthenticated visitor fell through to RequireUserRole's fallback, which
 * redirects to Overview, which then asked for login — and by then the address
 * they wanted was gone. This answers the session question first, so the
 * destination survives. The ROLE check still belongs to RequireUserRole.
 */
export function AdminRoute({ children }) {
  const { currentUser, loading: authLoading, authReady } = useAuth();
  const location = useLocation();

  if (!authReady || authLoading) {
    return <FullscreenLoader label="Restoring your session…" />;
  }

  if (!currentUser) {
    return <Navigate to={loginPathFor(location)} replace />;
  }

  return children;
}
