// ============================================================
// MARCOM / Lumi — Memory  (/app/memory) · the ACROSS axis
// ------------------------------------------------------------
// B7 locked four axes. Three had destinations:
//
//   NOW      Attention   /app/overview
//   THEN     Decisions   /app/decisions        (B8-03, a reclaim)
//   SUBJECT  Campaigns   /app/campaigns
//   ACROSS   Memory      — nothing
//
// ACROSS is the axis that holds everything Lumi believes about this account
// independent of any one campaign or any one decision, and it had no address.
// Its two readings were tabs under a fourth thing — "Intelligence · truth,
// insights, proof" — so the object a person would call "what Lumi has learned"
// could not be linked to, returned to, or named.
//
// B7 Ruling 2: MEMORY IS ONE SURFACE, READ TWO WAYS.
//
//   1. what Lumi has learned      GET /api/lumi/briefing   AccountBriefing
//   2. whether it has been right  GET /api/lumi/accuracy   ProofReading
//
// Two readings, ONE object. Not two features that happen to be adjacent: the
// second is a judgement on exactly the beliefs the first states, which is why
// a person must be able to see them together without changing address.
//
// WHAT THIS FILE DOES NOT DO, and the restraint is the point:
//   - it defines no primitive and no pattern. TAXONOMY-FREEZE blocks new
//     primitives below 80% adoption and adoption is 76%; the ruling for this
//     slice was "existing primitives only". So this composes `PageHeader` and
//     the two readings that already exist, both already prop-driven and both
//     already unit-tested where they live.
//   - it re-specifies nothing. Each reading keeps its own loading / failure /
//     empty behaviour, including AccountBriefing's B8-04b knowledge-token
//     states. A surface that moves a reading and re-words its absences has
//     changed what the product claims, under cover of an IA change.
//
// GATING — the trap this destination had to avoid.
//   Before the move the two readings had DIFFERENT entitlements:
//     /app/intelligence/insights   RoleGate STRATEGIST|BUYER  + PlanGate GROWTH
//     /app/intelligence/proof      no RoleGate                + PlanGate GROWTH
//   A CLIENT could read Proof of Learning (the view narrows itself to the
//   narrative line) and could not read the briefing. Putting one RoleGate
//   around this page would have deleted a CLIENT's access to Proof entirely —
//   a regression wearing the clothes of a consolidation. So the ROUTE carries
//   plan only, and the briefing reading carries the role gate it always had.
// ============================================================
import { Brain } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/design-system/patterns/index.js';
import RoleGate from '@/components/auth/RoleGate.jsx';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { useCollabRole, WORKSPACE_ROLE } from '@/hooks/useCollabRole.js';
import { useAccountBriefing } from '@/hooks/useAccountBriefing.js';
import { usePromotePattern } from '@/hooks/usePromotePattern.js';
import { AccountBriefing } from '@/features/intelligence/insights/AccountBriefing.jsx';
import { ProofReading } from '@/features/intelligence/proof/ProofView.jsx';

export default function MemoryView() {
  const { role } = useCollabRole();
  // STRATEGIST-tier owner decisions: opting the workspace into the anonymised
  // network, and granting a learned pattern standing authority as a rule.
  const canManageConsent = role === WORKSPACE_ROLE.STRATEGIST;

  const { briefing, loading, error, refetch, setConsent, consentBusy } = useAccountBriefing();
  const { requestPromotion, grantPromotion, revokePromotion, busyId: promotingId, error: promoteError } = usePromotePattern();

  // C-05 · the authorization filed for a pattern in THIS session. There is no
  // read of pending authorizations yet, so this is a session handle and not a
  // queue: after a reload the server answers a repeat request with
  // `AlreadyPending`, which the panel surfaces rather than papering over.
  const [pendingRequestId, setPendingRequestId] = useState({});

  const onRequestPromotion = async (patternId) => {
    const result = await requestPromotion(patternId);
    // Filing the authorization changes nothing about the account, so there is
    // nothing to re-read: the grant is the act that creates a rule.
    if (result?.requestId) setPendingRequestId((prev) => ({ ...prev, [patternId]: result.requestId }));
  };
  const onGrantPromotion = async (patternId, requestId) => {
    const result = await grantPromotion(requestId);
    if (result) {
      setPendingRequestId((prev) => { const next = { ...prev }; delete next[patternId]; return next; });
      await refetch(); // re-read so the promotable count + flags update
    }
  };
  const onRevokePromotion = async (ruleId) => {
    const result = await revokePromotion(ruleId);
    if (result) await refetch();
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <PageHeader
        title="Memory"
        description="What Lumi has learned about this account, and whether what it learned has held up. Both readings describe the same beliefs — they are never reconciled into one number."
      />

      {/* ── READING 1 · what Lumi has learned ──────────────────────
          RoleGate here rather than at the route: see the header. A CLIENT
          simply does not get this reading, exactly as before the move. */}
      <RoleGate role={[WORKSPACE_ROLE.STRATEGIST, WORKSPACE_ROLE.BUYER]}>
        <AccountBriefing
          briefing={briefing}
          loading={loading}
          error={error}
          onConsent={setConsent}
          consentBusy={consentBusy}
          canManageConsent={canManageConsent}
          onRequestPromotion={onRequestPromotion}
          onGrantPromotion={onGrantPromotion}
          onRevokePromotion={onRevokePromotion}
          pendingRequestId={pendingRequestId}
          promotingId={promotingId}
          promoteError={promoteError}
          canPromote={canManageConsent}
        />
      </RoleGate>

      {/* ── READING 2 · whether it has been any good ───────────────
          Ungated by role: ProofReading narrows itself (CLIENT sees the gated
          narrative line and no calibration number). The copy is the copy the
          old page carried, verbatim — a move is not the place to restate what
          a surface means. */}
      <section className="mt-10">
        <div className="section-label flex items-center gap-2">
          <Brain className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
          Proof of Learning
          <HelpTip variant="popover" content={HELP.PROOF_OF_LEARNING} size={14} />
        </div>
        <p className="mt-1 text-lumi-muted text-sm mb-4">
          Is Lumi getting more calibrated on this account over time?
        </p>
        <ProofReading />
      </section>
    </div>
  );
}
