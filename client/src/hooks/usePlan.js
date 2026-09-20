// ============================================================
// MARCOM / Lumi — usePlan (feature-gating entitlement)
// ------------------------------------------------------------
// Thin derivation over useWorkspace: exposes the workspace's plan tier
// (FREE | GROWTH | PRO) and a hierarchical `canAccess(required)` check that
// drives the Sidebar lock state and the PlanGate route guard.
//
// This is a UX/upsell gate, NOT a security boundary. The truth lives
// server-side: GET /api/user/workspace returns `plan`, and `requirePlan` (
// src/middleware/requirePlan.js) is mounted on nine route groups as the actual
// paywall. An earlier version of this comment said the plan was enforced in the
// client only and that a server gate was "out of scope"; that was already
// untrue when written, and it mattered, because it framed this file's guesses
// as harmless.
//
// ── WHY `plan` CAN BE null (Phase 5.9) ─────────────────────────────────────
// It used to be `workspace?.plan ?? 'FREE'`. `useWorkspace` returns
// `workspace: null` on EVERY failure path, so a 500, a dropped connection, a
// 403 and a 200 carrying no plan all resolved to a confident FREE — and the
// route gate then told a PRO operator that Memory "is a Growth feature" and
// invited them to upgrade. A failed read is not a plan, and an upgrade wall is
// a billing claim.
//
// So entitlement is now claimed ONLY from WORKSPACE_READ.PRESENT. Every other
// status yields `plan: null`, `canAccess() === false`, and a status the gate
// renders as absence rather than as a tier. Refusing is the safe direction:
// `canAccess` never opens a surface on an unknown plan.
//
// While the workspace is still loading we DON'T know the plan yet, so callers
// should treat `loading` as "don't lock yet" — never flash a lock at a paying
// operator mid-load (usePlan returns loading; the Sidebar/PlanGate wait on it).
// ============================================================
import { useWorkspace, WORKSPACE_READ } from './useWorkspace.js';

export { WORKSPACE_READ };

// Higher number = more access. Used only once the plan is KNOWN.
export const PLAN_HIERARCHY = { FREE: 0, GROWTH: 1, PRO: 2 };
const rank = (p) => PLAN_HIERARCHY[p] ?? 0;

export function usePlan() {
  const { workspace, loading, status } = useWorkspace();
  // One condition governs every answer below, so no branch can accidentally
  // treat an unestablished entitlement as a tier.
  const known = status === WORKSPACE_READ.PRESENT;
  const plan = known ? (workspace?.plan ?? null) : null;

  return {
    plan,
    status,
    loading,
    /** True only for a workspace we READ and whose plan IS FREE. */
    isFree:   known && plan === 'FREE',
    isGrowth: known && rank(plan) >= PLAN_HIERARCHY.GROWTH, // GROWTH or PRO
    isPro:    known && plan === 'PRO',
    // True iff the plan is KNOWN and meets or exceeds the required tier. An
    // absent requirement (undefined) is ungated → always accessible, entitlement
    // never consulted.
    canAccess: (required) => (required == null ? true : known && rank(plan) >= rank(required)),
  };
}
