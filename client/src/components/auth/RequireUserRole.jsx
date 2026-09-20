// ============================================================
// MARCOM / Lumi — RequireUserRole (system-role route guard)
// ------------------------------------------------------------
// Gates a route/subtree to the SYSTEM role axis (ADMIN | VIEWER). Errs CLOSED:
// renders NOTHING while the role resolves (never a flash of admin content),
// then either the children (ADMIN) or the fallback (everyone else).
//
// Distinct from RoleGate.jsx, which gates the orthogonal collabRole and reads
// RoleContext. This one reads useUserRole (a standalone fetch), so it works on
// the /admin route that lives outside the RoleProvider-wrapped app shell.
// ============================================================
import { useUserRole, ADMIN_READ } from '@/hooks/useUserRole.js';
import RoleUnavailable from './RoleUnavailable.jsx';

export default function RequireUserRole({ role = 'ADMIN', fallback = null, unavailable, children }) {
  const { isAdmin, isLoading, status } = useUserRole();
  if (isLoading || status === ADMIN_READ.LOADING) return null;

  // Phase 5.11 — the direction is unchanged: this gate has always failed CLOSED
  // and still does. What changes is that a failed read stops being SPELLED like
  // a denial. `fallback` here is a redirect off /admin; firing it on an outage
  // told a genuine ADMIN they lack a permission, and a VIEWER and a 500 left
  // the identical trace (measured, Phase 5.10). An unread seat now says so.
  if (status !== ADMIN_READ.PRESENT) return unavailable ?? <RoleUnavailable status={status} />;

  // Only ADMIN is a meaningful gate today (VIEWER is the default for everyone
  // else). A redirect-style fallback must never fire mid-load — hence the
  // isLoading short-circuit above.
  if (role === 'ADMIN' && !isAdmin) return fallback;
  return children;
}
