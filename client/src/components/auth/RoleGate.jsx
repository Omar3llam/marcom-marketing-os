// ============================================================
// MARCOM / Lumi — RoleGate (Phase 11A · the gating seam)
// ------------------------------------------------------------
// Renders children only when the caller's collabRole is in the allow-list.
// Used at BOTH nav and route level. While the role is still loading it renders
// NOTHING (null) — NEVER the fallback. A route-level fallback is a redirect
// (RoleAwareRedirect); firing it before the role resolves bounces an entitled
// operator mid-load (the Growth-Strategy→Overview race). Only once the role has
// RESOLVED do we decide: children for an allowed role, `fallback` for a denied
// one (default null) — at route level pass a narrative/summary fallback so a
// CLIENT sees the reasoned story, never the controls.
//
//   <RoleGate role={['STRATEGIST']}>            ...full controls...     </RoleGate>
//   <RoleGate role={['STRATEGIST','BUYER']} fallback={<Summary/>}> ... </RoleGate>
// ============================================================
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { ROLE_READ } from '@/context/RoleContext.jsx';
import RoleUnavailable from './RoleUnavailable.jsx';

export default function RoleGate({ role, fallback = null, unavailable, children }) {
  const { role: current, loading, status, canRetry, refetch } = useCollabRole();
  const allow = Array.isArray(role) ? role : [role];

  if (loading || status === ROLE_READ.LOADING) return null;
  // Phase 5.11 — three outcomes, not two. `fallback` is a DENIAL (at route
  // level a redirect, or a narrative for a CLIENT); it names a seat the caller
  // does not hold. An unread seat is not a denial, so it may not route and may
  // not borrow that sentence. Children stay withheld either way — the gate
  // still refuses, it just stops claiming a reason it does not have.
  //
  // MainLayout already holds the shell on an unread seat, so in practice this
  // fires only outside it or if that boundary is ever moved. Kept because a
  // gate that depends on another gate is not a gate.
  if (status !== ROLE_READ.PRESENT) return unavailable ?? <RoleUnavailable status={status} canRetry={canRetry} onRetry={refetch} />;
  return allow.includes(current) ? children : fallback;
}

/**
 * Imperative form for filtering lists (e.g. nav items).
 *
 * `current` is null when the seat was not read, and null is in no allow-list,
 * so a constrained item is withheld — fail closed. An UNCONSTRAINED item stays
 * visible: withholding it would claim a restriction that does not exist.
 */
export function roleAllowed(current, allowed) {
  if (!allowed || allowed.length === 0) return true; // no constraint → visible to all
  return allowed.includes(current);
}
