// ============================================================
// MARCOM / Lumi — SectionNotPermitted (Phase 5.12 · R-15)
// ------------------------------------------------------------
// What a Settings section shows to a seat that is not its audience.
//
// This is a REFUSAL, and refusals and failures are not the same state. The seat
// was read, the answer arrived, and the answer excludes this section: we can
// name the permission, so we name it. That is why it is not `RoleUnavailable`,
// which says the opposite thing — that we could not read the seat at all.
//
// The mark follows B8-02's convention from DetailGrammar: NOT_PERMITTED gets a
// lock, never a warning triangle. "This is not yours to open" and "something
// went wrong" invite different next actions, and rendering an entitlement as a
// fault invites a retry that can only fail again.
//
// The sentence states the rule and nothing else. It does not claim a plan, an
// upgrade path or an account fact — the caller's role is the only thing this
// component knows.
// ============================================================
import { Lock } from 'lucide-react';
import { StateBlock } from '@/design-system/patterns/index.js';

/** en-GB sentence for a role list: ['STRATEGIST'] → "a strategist". */
function audience(roles) {
  const names = (roles ?? []).map((r) => r.toLowerCase());
  if (names.length === 0) return 'another role';
  if (names.length === 1) return `a ${names[0]}`;
  return `a ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

export default function SectionNotPermitted({ label, roles }) {
  return (
    <StateBlock
      icon={Lock}
      title="Restricted section"
      description={`Only ${audience(roles)} can open ${label} in this workspace.`}
    />
  );
}
