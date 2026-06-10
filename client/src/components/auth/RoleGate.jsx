// ============================================================
// MARCOM / Lumi — RoleGate (Phase 11A · the gating seam)
// ------------------------------------------------------------
// Renders children only when the caller's collabRole is in the allow-list.
// Used at BOTH nav and route level. While the role is still loading it renders
// `fallback` (no flash of gated content). A denied role also gets `fallback`
// (default null) — at route level pass a narrative/summary fallback so a CLIENT
// sees the reasoned story, never the controls.
//
//   <RoleGate role={['STRATEGIST']}>            ...full controls...     </RoleGate>
//   <RoleGate role={['STRATEGIST','BUYER']} fallback={<Summary/>}> ... </RoleGate>
// ============================================================
import { useCollabRole } from '@/hooks/useCollabRole.js';

export default function RoleGate({ role, fallback = null, children }) {
  const { role: current, loading } = useCollabRole();
  const allow = Array.isArray(role) ? role : [role];

  if (loading) return fallback;
  return allow.includes(current) ? children : fallback;
}

/** Imperative form for filtering lists (e.g. nav items). */
export function roleAllowed(current, allowed) {
  if (!allowed || allowed.length === 0) return true; // no constraint → visible to all
  return allowed.includes(current);
}
