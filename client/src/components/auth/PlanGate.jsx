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
// ── THREE OUTCOMES, NOT TWO (Phase 5.9) ────────────────────────────────────
// `fallback` is an UPGRADE WALL: it says "your plan is below this tier", which
// is a billing claim about a plan we read. It may therefore render ONLY from
// WORKSPACE_READ.PRESENT. A failed read, a 403, an absent workspace and a 200
// carrying no usable plan are not tiers — they are absences, and each used to
// arrive here disguised as FREE and produce that wall. So:
//
//     loading            → nothing
//     PRESENT + entitled → children
//     PRESENT + below    → fallback (the upgrade wall)
//     anything else      → `unavailable` — absence, never an upgrade claim
//
// The gate still refuses: an unknown entitlement never renders children. It
// simply stops explaining the refusal with a sentence about money.
//
// Compose with RoleGate OUTSIDE this (role decides visibility; a CLIENT is
// routed to Reports before we ever consider the plan).
// ============================================================
import { usePlan, WORKSPACE_READ } from '@/hooks/usePlan.js';
import { ErrorState } from '@/design-system/patterns/index.js';

/**
 * The default absence surface.
 *
 * The wording is B8-02's already-approved UNREADABLE copy, reused verbatim
 * rather than written fresh (overviewState.js). The second line — "a problem on
 * our side" — is TRUE of a failed read and NOT true of a refusal, so
 * NOT_PERMITTED gets the first line alone. Inventing a permission sentence here
 * would be inventing product copy; naming the gap is the honest move, and it is
 * an open ruling.
 */
function EntitlementUnavailable({ status }) {
  const permissionDenied = status === WORKSPACE_READ.NOT_PERMITTED;
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <ErrorState
        tone="warning"
        className="max-w-md"
        title="Lumi couldn’t read this account just now."
        description={permissionDenied ? undefined : 'This is a problem on our side, not a verdict about your campaigns.'}
      />
    </div>
  );
}

export default function PlanGate({ required, fallback = null, unavailable, children }) {
  const { canAccess, loading, status } = usePlan();

  if (loading) return null;
  if (status !== WORKSPACE_READ.PRESENT) {
    return unavailable ?? <EntitlementUnavailable status={status} />;
  }
  return canAccess(required) ? children : fallback;
}
