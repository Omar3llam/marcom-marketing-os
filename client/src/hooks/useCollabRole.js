// ============================================================
// MARCOM / Lumi — useCollabRole (Phase 11A)
// ------------------------------------------------------------
// Thin accessor over RoleContext. Returns { role, visibleStates, loading, error }.
// The single client read-point for the Phase-8 collabRole (STRATEGIST|BUYER|CLIENT).
// ============================================================
import { useRoleContext, WORKSPACE_ROLE } from '@/context/RoleContext.jsx';

export { WORKSPACE_ROLE };

export function useCollabRole() {
  return useRoleContext();
}
