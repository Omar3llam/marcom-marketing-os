// ============================================================
// MARCOM / Lumi — PlanGate (feature-gating seam)
// ------------------------------------------------------------
// The plan-tier sibling of RoleGate. Renders children only when the workspace's
// plan meets the `required` tier (FREE | GROWTH | PRO). While the plan is still
// loading it renders NOTHING (null) — never the fallback — so an under-load
// miss never flashes an upgrade wall at a paying operator (same discipline as
// RoleGate's loading guard). Once resolved: children if entitled, else
// `fallback` (at route level pass <UpgradePrompt/> so the user sees why + how
// to upgrade, rather than a silent redirect).
//
//   <PlanGate required="GROWTH" fallback={<UpgradePrompt .../>}> ... </PlanGate>
//
// Compose with RoleGate OUTSIDE this (role decides visibility; a CLIENT is
// routed to Reports before we ever consider the plan).
// ============================================================
import { usePlan } from '@/hooks/usePlan.js';

export default function PlanGate({ required, fallback = null, children }) {
  const { canAccess, loading } = usePlan();

  if (loading) return null;
  return canAccess(required) ? children : fallback;
}
