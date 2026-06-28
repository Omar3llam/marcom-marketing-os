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
import { useUserRole } from '@/hooks/useUserRole.js';

export default function RequireUserRole({ role = 'ADMIN', fallback = null, children }) {
  const { isAdmin, isLoading } = useUserRole();
  if (isLoading) return null;
  // Only ADMIN is a meaningful gate today (VIEWER is the default for everyone
  // else). A redirect-style fallback must never fire mid-load — hence the
  // isLoading short-circuit above.
  if (role === 'ADMIN' && !isAdmin) return fallback;
  return children;
}
