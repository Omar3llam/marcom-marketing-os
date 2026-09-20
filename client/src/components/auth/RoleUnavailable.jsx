// ============================================================
// MARCOM / Lumi — RoleUnavailable (Phase 5.11, copy corrected in 5.14)
// ------------------------------------------------------------
// What a surface shows when the caller's ACCESS LEVEL could not be established.
// It is deliberately NOT a denial: a denial names a permission the user lacks,
// and for two of these three states we do not know one.
//
// ── ONE STATE, ONE SENTENCE (R-14, Phase 5.14) ─────────────────────────────
// Until 5.14 all three states rendered the same title — B8-02's UNREADABLE copy
// — and merely dropped a line for NOT_PERMITTED. That was honest but blunt: a
// seat with no role assigned (which no retry will fix, and which a Strategist
// CAN fix) read exactly like a database outage.
//
// Each state now says what LUMI actually established, and only that:
//
//   NOTHING_FOUND  the read SUCCEEDED and this seat carries no role. An answer,
//                  not a failure — and the one state here with a real next step.
//   NOT_REACHABLE  the read did not complete. Our position, not a fact about
//                  the account. No action is offered because none exists (see
//                  RECOVERY below).
//   NOT_PERMITTED  we were refused the read itself. Distinct from "you may not
//                  see this feature", which is a section refusal and lives in
//                  SectionNotPermitted.
//
// ── WHY THE SUBJECT MATTERS ────────────────────────────────────────────────
// A failure sentence's subject is LUMI ("Lumi couldn't…"). A refusal sentence's
// subject is the RULE ("Only a strategist can…"). "You don't have permission"
// is never used for a state we did not establish — that is the inversion R-14
// exists to prevent.
//
// ── WHY THE AXIS IS NAMED ──────────────────────────────────────────────────
// "this account" was used by five different reads, so a role failure and a
// workspace failure were textually identical (Phase 5.13, M-4). These sentences
// say ACCESS; PlanGate's say WORKSPACE.
//
// ── RECOVERY: THERE IS NONE, SO NONE IS PROMISED ───────────────────────────
// RoleContext fetches once with `[]` deps and exposes no refetch, so a reload
// is the only recovery. No "Try again" control is rendered, and no sentence
// tells the user to retry — a button that does not re-read would be a lie, and
// wiring one changes when a role is re-read, which is a semantics change and
// not this phase's. Recorded as follow-up in PHASE_5_14.
// ============================================================
import { AlertTriangle, Lock, UserX } from 'lucide-react';
// From the vocabulary's HOME rather than RoleContext's re-export: the copy map
// below is built at module scope, and a context a suite mocks must not be able
// to turn that into an import-time crash. ROLE_READ and READ are the same
// frozen object.
import { READ as ROLE_READ } from '@/design-system/states/readStatus.js';
import { StateBlock } from '@/design-system/patterns/index.js';

/**
 * One row per state. Declared as data rather than nested ternaries so that a
 * state added to READ without a sentence is visible as a gap, and so the
 * "no two states read alike" rule can be asserted by a test.
 */
const COPY = {
  [ROLE_READ.NOTHING_FOUND]: {
    icon: UserX,
    title: 'No access level is set for your account.',
    description: 'Ask a Strategist in your workspace to assign one. Nothing is wrong with your account.',
  },
  [ROLE_READ.NOT_REACHABLE]: {
    icon: AlertTriangle,
    title: 'Lumi couldn’t check your access just now.',
    description: 'This is a problem on our side. Nothing about your account has changed.',
  },
  [ROLE_READ.NOT_PERMITTED]: {
    icon: Lock,
    // No second line: "a problem on our side" is true of an outage and false of
    // a refusal, and we will not invent a permission sentence we cannot support.
    title: 'Lumi isn’t allowed to check your access.',
    description: undefined,
  },
};

export default function RoleUnavailable({ status }) {
  // An unrecognised status falls to the least-claiming sentence. It says only
  // what is certainly true — we do not have an access level to act on — and
  // promises nothing about why.
  const copy = COPY[status] ?? COPY[ROLE_READ.NOT_REACHABLE];
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <StateBlock
        tone="warning"
        className="max-w-md"
        icon={copy.icon}
        title={copy.title}
        description={copy.description}
      />
    </div>
  );
}

/** Exported for the exhaustiveness test — not for rendering. */
export { COPY as ROLE_UNAVAILABLE_COPY };
