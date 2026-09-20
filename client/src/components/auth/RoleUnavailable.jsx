// ============================================================
// MARCOM / Lumi — RoleUnavailable (Phase 5.11)
// ------------------------------------------------------------
// What a surface shows when the caller's access level could not be READ. It is
// deliberately NOT a denial: a denial names a permission the user lacks, and we
// do not know one. It is the absence of an answer, said out loud.
//
// The wording is B8-02's already-approved UNREADABLE copy, reused verbatim
// rather than written fresh (overviewState.js) — the role read IS an account
// read, so the sentence is true of it. The second line ("a problem on our
// side") is true of an outage and FALSE of a refusal, so NOT_PERMITTED gets the
// first line alone. Inventing a permission sentence here would be inventing
// product copy; naming the gap is the honest move, and R-14's copy for an
// explicit refusal is still an open ruling.
// ============================================================
import { ROLE_READ } from '@/context/RoleContext.jsx';
import { ErrorState } from '@/design-system/patterns/index.js';

export default function RoleUnavailable({ status }) {
  const refused = status === ROLE_READ.NOT_PERMITTED;
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <ErrorState
        tone="warning"
        className="max-w-md"
        title="Lumi couldn’t read this account just now."
        description={refused ? undefined : 'This is a problem on our side, not a verdict about your campaigns.'}
      />
    </div>
  );
}
