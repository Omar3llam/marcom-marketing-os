// ============================================================
// MARCOM / Lumi — useUserRole
// ------------------------------------------------------------
// The single client read-point for the SYSTEM role axis (ADMIN | VIEWER),
// orthogonal to collabRole (STRATEGIST/BUYER/CLIENT, served by RoleContext).
// Fetches GET /api/lumi/roles/me directly (NOT via RoleContext) so it also
// works on the standalone /admin route, which lives OUTSIDE the app shell where
// RoleProvider is mounted.
//
// Errs CLOSED — the opposite of RoleContext's err-open default. A transient
// miss (or an unauthenticated visit) must never GRANT admin: { isAdmin:false }.
// ============================================================
import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { READ, readStatusForError } from '@/design-system/states/readStatus.js';

/** The read vocabulary, re-exported so admin consumers need not know its home. */
export { READ as ADMIN_READ };

export function useUserRole() {
  const { currentUser } = useAuth();
  const [state, setState] = useState({ isAdmin: false, isLoading: true, status: READ.LOADING });

  useEffect(() => {
    let cancelled = false;

    // No session → not admin, nothing to fetch.
    if (!currentUser) {
      // No session, so the read was never made. Not admin, and not a refusal.
      setState({ isAdmin: false, isLoading: false, status: READ.NOT_REACHABLE });
      return;
    }

    setState((s) => ({ ...s, isLoading: true, status: READ.LOADING }));
    (async () => {
      try {
        const res = await api.get('/api/lumi/roles/me');
        if (cancelled) return;
        // A 200 that does not carry a userRole answers nothing: it is not a
        // confirmed VIEWER, and it is certainly not an ADMIN.
        const userRole = res.data?.userRole ?? null;
        const known = userRole === 'ADMIN' || userRole === 'VIEWER';
        setState({
          isAdmin: userRole === 'ADMIN',
          isLoading: false,
          status: known ? READ.PRESENT : READ.NOT_REACHABLE,
        });
      } catch (err) {
        if (cancelled) return;
        // Still CLOSED — a failed read never grants admin. The status only
        // makes the REASON legible, so an outage stops looking like a refusal.
        setState({ isAdmin: false, isLoading: false, status: readStatusForError(err) });
      }
    })();

    return () => { cancelled = true; };
  }, [currentUser]);

  return state;
}
