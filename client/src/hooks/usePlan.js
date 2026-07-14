// ============================================================
// MARCOM / Lumi — usePlan (feature-gating entitlement)
// ------------------------------------------------------------
// Thin derivation over useWorkspace: exposes the workspace's plan tier
// (FREE | GROWTH | PRO) and a hierarchical `canAccess(required)` check that
// drives the Sidebar lock state and the PlanGate route guard.
//
// This is a UX/upsell gate, NOT a security boundary — the plan is enforced in
// the client only. The truth still lives server-side (GET /api/user/workspace
// returns `plan`); a real paywall would additionally gate the data routes with
// a `requirePlan` middleware (mirrors requireMeasurementTier). Out of scope here.
//
// While the workspace is still loading we DON'T know the plan yet, so callers
// should treat `loading` as "don't lock yet" — never flash a lock at a paying
// operator mid-load (usePlan returns loading; the Sidebar/PlanGate wait on it).
// ============================================================
import { useWorkspace } from './useWorkspace.js';

// Higher number = more access. An unknown/absent plan floors to FREE.
export const PLAN_HIERARCHY = { FREE: 0, GROWTH: 1, PRO: 2 };
const rank = (p) => PLAN_HIERARCHY[p] ?? 0;

export function usePlan() {
  const { workspace, loading } = useWorkspace();
  const plan = workspace?.plan ?? 'FREE';

  return {
    plan,
    loading,
    isFree:   plan === 'FREE',
    isGrowth: rank(plan) >= PLAN_HIERARCHY.GROWTH, // GROWTH or PRO
    isPro:    plan === 'PRO',
    // True iff the current plan meets or exceeds the required tier. An absent
    // requirement (undefined) is treated as ungated → always accessible.
    canAccess: (required) => required == null || rank(plan) >= rank(required),
  };
}
