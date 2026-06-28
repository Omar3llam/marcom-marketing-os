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

export function useUserRole() {
  const { currentUser } = useAuth();
  const [state, setState] = useState({ isAdmin: false, isLoading: true });

  useEffect(() => {
    let cancelled = false;

    // No session → not admin, nothing to fetch.
    if (!currentUser) {
      setState({ isAdmin: false, isLoading: false });
      return;
    }

    setState((s) => ({ ...s, isLoading: true }));
    (async () => {
      try {
        const res = await api.get('/api/lumi/roles/me');
        if (cancelled) return;
        setState({ isAdmin: res.data?.userRole === 'ADMIN', isLoading: false });
      } catch {
        if (cancelled) return;
        setState({ isAdmin: false, isLoading: false });
      }
    })();

    return () => { cancelled = true; };
  }, [currentUser]);

  return state;
}
