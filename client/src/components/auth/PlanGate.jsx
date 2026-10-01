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
import { AlertTriangle, Lock, SearchX } from 'lucide-react';
import { usePlan } from '@/hooks/usePlan.js';
// The vocabulary comes from its HOME, not through the hook's re-export. The
// copy map below is built at MODULE SCOPE, and `usePlan.js` is whole-module
// mocked by several suites — keying a static map off a mockable hook makes
// every one of those mocks responsible for a constant it does not care about,
// and the failure is an import-time crash rather than a readable assertion.
// READ and WORKSPACE_READ are the same frozen object.
import { READ as WORKSPACE_READ } from '@/design-system/states/readStatus.js';
import { StateBlock } from '@/design-system/patterns/index.js';

/**
 * The default absence surface — one sentence per state (R-14, Phase 5.14).
 *
 * Until 5.14 every non-PRESENT status rendered the same "Lumi couldn't read
 * this account just now." That was wrong in two ways, and Phase 5.13 measured
 * both:
 *
 *   · NOTHING_FOUND is a MEASURED ANSWER. `useWorkspace` sets it when the
 *     server explicitly replies `hasWorkspace: false` — the read SUCCEEDED.
 *     Saying "couldn't read" and "a problem on our side" were both FALSE
 *     statements about Lumi's own position, on a reachable path. B8-02 holds
 *     this token apart from the absences for exactly this reason
 *     (absence.js — isAbsent() answers false for it).
 *
 *   · The sentence named no axis, so a workspace failure and a ROLE failure
 *     were textually identical. These say WORKSPACE; RoleUnavailable's say
 *     ACCESS.
 *
 * What is NOT claimed: no plan, no tier, no upgrade path. An unread entitlement
 * is not a FREE seat (Phase 5.9), and none of these sentences mentions money.
 *
 * Retry is offered only for transient failed reads.
 */
const ENTITLEMENT_COPY = {
  [WORKSPACE_READ.NOTHING_FOUND]: {
    icon: SearchX,
    title: 'Lumi couldn’t find a workspace for this account.',
    // Deliberately no instruction. What a person should DO about having no
    // workspace is an open product ruling (R-14.b), and inventing a next step
    // here would be inventing product.
    description: 'Your account is signed in, but no workspace is attached to it yet.',
  },
  [WORKSPACE_READ.NOT_REACHABLE]: {
    icon: AlertTriangle,
    title: 'Lumi couldn’t read your workspace just now.',
    description: 'This is a problem on our side, not a verdict about your campaigns.',
  },
  [WORKSPACE_READ.NOT_PERMITTED]: {
    icon: Lock,
    title: 'Lumi isn’t allowed to read this workspace.',
    description: undefined,
  },
};

function EntitlementUnavailable({ status, canRetry, onRetry }) {
  const copy = ENTITLEMENT_COPY[status] ?? ENTITLEMENT_COPY[WORKSPACE_READ.NOT_REACHABLE];
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <StateBlock
        tone="warning"
        className="max-w-md"
        icon={copy.icon}
        title={copy.title}
        description={copy.description}
        action={status === WORKSPACE_READ.NOT_REACHABLE && canRetry && onRetry ? <button type="button" onClick={onRetry}>Retry workspace</button> : undefined}
      />
    </div>
  );
}

/** Exported for the exhaustiveness test — not for rendering. */
export { ENTITLEMENT_COPY };

export default function PlanGate({ required, fallback = null, unavailable, children }) {
  const { canAccess, loading, status, canRetry, refetch } = usePlan();

  if (loading) return null;
  if (status !== WORKSPACE_READ.PRESENT) {
    return unavailable ?? <EntitlementUnavailable status={status} canRetry={canRetry} onRetry={refetch} />;
  }
  return canAccess(required) ? children : fallback;
}
