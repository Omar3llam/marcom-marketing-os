// ============================================================
// MARCOM / Lumi — PromotionService (C-05)
// ------------------------------------------------------------
// Granting Lumi durable authority, and taking it back.
//
//   requestPromotion()  a person proposes that a learned pattern become a rule.
//                       Files an ApprovalRequest. Creates NOTHING else.
//   decidePromotion()   a STRATEGIST grants or refuses. On a grant — and only
//                       there — the GuardrailRule is created, linked, and the
//                       belief that justified it is frozen into the audit log.
//   revokePromotion()   the authority is withdrawn. The rule stops being
//                       evaluated; nothing about the past is rewritten.
//
// ── WHY THIS IS NOT ApprovalService ─────────────────────────────────────────
//
// It reuses ApprovalService's SUBSTRATE — `ApprovalRequest` and
// `CollaborationEvent` — and none of its semantics. `ApprovalService` sets
// `Plan.requiresApproval` and `Plan.approvalState`, and `isExecutionBlocked`
// reads them: that gate is about a buyer executing a strategist's allocation.
// Promotion is a different question with a different subject, and hanging it on
// the plan switch would have made two unrelated authorizations share a state.
//
// ── WHAT IS RE-CHECKED AT THE DECISION, AND WHY ─────────────────────────────
//
// The governance gate runs TWICE: once when the request is filed, once when it
// is granted. `AccountPattern` is upserted in place, so the belief can degrade
// while the request sits in a queue — and a snapshot is a record of what was
// believed, never a licence to act on a belief that has since failed.
//
// When it has degraded, both readings are written to the audit log side by side
// and neither is corrected against the other. R-5: divergence between two
// records of the same thing is a fact.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { patternToGuardrailData, PROMOTE_MIN_ACCURACY } from './PlaybookService.js';
import {
  beliefSnapshot, promotionSnapshot,
  PROMOTION_SUBJECT_TYPE, AUTONOMY_EVENT, REFUSAL,
} from './promotionSnapshot.js';

export const PROMOTION_STATE = Object.freeze({ PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' });

/** Typed refusals, so the route answers 403/404/409 rather than 500. */
function refuse(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/** Only a STRATEGIST may hand out — or take back — standing authority. */
function assertStrategist(role, what) {
  if (role !== 'STRATEGIST') {
    throw refuse('RoleForbidden', `Only a STRATEGIST may ${what}.`);
  }
}

// ─────────────────────────────────────────────────────────────
// 1 · PROPOSE
// ─────────────────────────────────────────────────────────────
/**
 * File a promotion authorization. Grants nothing.
 *
 * @param {string} workspaceId
 * @param {{ patternId: string, requestedById: string }} input
 * @returns {Promise<{ requestId: string, state: string }>}
 */
export async function requestPromotion(workspaceId, { patternId, requestedById } = {}) {
  if (!workspaceId) throw new Error('requestPromotion: workspaceId required');
  if (!patternId)   throw new Error('requestPromotion: patternId required');
  // R-13 requires the trail to prove WHO proposed. An authorization nobody can
  // be named for is not an authorization, so this refuses rather than writing a
  // null actor and calling the record complete.
  if (!requestedById) throw refuse('ActorUnresolved', 'requestedById is required to file a promotion.');

  // R9 (I40) — the scope is IN the query, not checked after it.
  const pattern = await prisma.accountPattern.findFirst({ where: { id: patternId, workspaceId } });
  if (!pattern) throw refuse('NotFound', 'Pattern not found in this workspace.');

  // The same gate the grant will apply. Refusing here means a request that
  // could never be granted is never filed — and the reason reaches the person
  // who asked, at the moment they asked.
  patternToGuardrailData(pattern, workspaceId); // throws if not promotable

  const pending = await prisma.approvalRequest.findFirst({
    where: { workspaceId, subjectType: PROMOTION_SUBJECT_TYPE, subjectId: patternId, state: PROMOTION_STATE.PENDING },
    select: { id: true },
  });
  if (pending) {
    throw refuse('AlreadyPending', 'A promotion for this pattern is already pending a decision.');
  }

  const beliefAtRequest = beliefSnapshot(pattern);

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.approvalRequest.create({
      data: {
        workspaceId,
        // Promotion is not an allocation. It borrows the table, never the plan gate.
        planId: null,
        subjectType: PROMOTION_SUBJECT_TYPE,
        subjectId: patternId,
        requestedById,
        state: PROMOTION_STATE.PENDING,
      },
    });
    await tx.collaborationEvent.create({
      data: {
        workspaceId, actorId: requestedById, type: 'APPROVAL_REQUESTED',
        subjectType: PROMOTION_SUBJECT_TYPE,
        // The PATTERN is the spine of this history: rules come and go, and a
        // re-promotion mints a new one. Anchoring every event to the pattern
        // makes the whole chain one indexed read.
        subjectId: patternId,
        detail: { requestId: created.id, beliefAtRequest, minAccuracyApplied: PROMOTE_MIN_ACCURACY },
      },
    });
    return created;
  });

  logger.info({ workspaceId, patternId, requestId: request.id }, '[PromotionService] promotion requested');
  return { requestId: request.id, state: PROMOTION_STATE.PENDING };
}

// ─────────────────────────────────────────────────────────────
// 2 · DECIDE
// ─────────────────────────────────────────────────────────────
/**
 * Grant or refuse a filed promotion.
 *
 * @param {string} workspaceId
 * @param {{ requestId, decision, approverId, approverRole, beliefAtRequest? }} input
 * @returns {Promise<{ state: string, ruleId: string|null }>}
 */
export async function decidePromotion(workspaceId, {
  requestId, decision, approverId, approverRole, beliefAtRequest = null,
} = {}) {
  if (!workspaceId) throw new Error('decidePromotion: workspaceId required');
  if (decision !== PROMOTION_STATE.APPROVED && decision !== PROMOTION_STATE.REJECTED) {
    throw new Error("decidePromotion: decision must be 'APPROVED' or 'REJECTED'");
  }
  assertStrategist(approverRole, 'decide a promotion');
  if (!approverId) throw refuse('ActorUnresolved', 'approverId is required to decide a promotion.');

  const request = await prisma.approvalRequest.findFirst({
    where: { id: requestId, workspaceId, subjectType: PROMOTION_SUBJECT_TYPE },
  });
  if (!request) throw refuse('NotFound', 'Promotion request not found in this workspace.');
  if (request.state !== PROMOTION_STATE.PENDING) {
    throw refuse('AlreadyDecided', `This promotion was already ${request.state}.`);
  }

  // Today only a STRATEGIST may request a promotion and only a STRATEGIST may
  // grant one, so one person legitimately does both. That is a real two-step
  // authorization and it is NOT four eyes — recorded, never disguised.
  const selfApproved = request.requestedById === approverId;

  if (decision === PROMOTION_STATE.REJECTED) {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.approvalRequest.update({
        where: { id: request.id },
        data: { state: PROMOTION_STATE.REJECTED, decidedById: approverId, decidedAt: new Date() },
      });
      await tx.collaborationEvent.create({
        data: {
          workspaceId, actorId: approverId, type: 'APPROVAL_DECIDED',
          subjectType: PROMOTION_SUBJECT_TYPE, subjectId: request.subjectId,
          detail: { requestId: request.id, decision: PROMOTION_STATE.REJECTED, selfApproved },
        },
      });
      return row;
    });
    logger.info({ workspaceId, requestId, decision }, '[PromotionService] promotion refused by approver');
    return { state: updated.state, ruleId: null };
  }

  // ── APPROVED ──────────────────────────────────────────────────────────────
  const pattern = await prisma.accountPattern.findFirst({ where: { id: request.subjectId, workspaceId } });
  if (!pattern) throw refuse('NotFound', 'Pattern not found in this workspace.');

  const beliefAtDecision = beliefSnapshot(pattern);

  let ruleData;
  try {
    ruleData = patternToGuardrailData(pattern, workspaceId);
  } catch (err) {
    // The approver said yes; the belief no longer supports it. Both readings are
    // kept, side by side, and neither is corrected against the other. The row
    // records that this ended without a grant AND that the approver is not who
    // refused it.
    await prisma.$transaction(async (tx) => {
      await tx.approvalRequest.update({
        where: { id: request.id },
        data: {
          state: PROMOTION_STATE.REJECTED, decidedById: approverId,
          decidedAt: new Date(), reason: REFUSAL.BELIEF_DEGRADED,
        },
      });
      await tx.collaborationEvent.create({
        data: {
          workspaceId, actorId: approverId, type: 'APPROVAL_DECIDED',
          subjectType: PROMOTION_SUBJECT_TYPE, subjectId: request.subjectId,
          detail: {
            requestId: request.id, decision: PROMOTION_STATE.APPROVED,
            outcome: REFUSAL.OUTCOME, selfApproved, reason: err.message,
            beliefAtRequest, beliefAtDecision,
          },
        },
      });
    });
    logger.warn({ workspaceId, requestId, err: err.message }, '[PromotionService] grant refused — belief degraded');
    throw refuse('BeliefDegraded', err.message, { beliefAtRequest, beliefAtDecision });
  }

  const rule = await prisma.$transaction(async (tx) => {
    const created = await tx.guardrailRule.create({ data: ruleData });
    await tx.accountPattern.update({ where: { id: pattern.id }, data: { promotedRuleId: created.id } });
    await tx.approvalRequest.update({
      where: { id: request.id },
      data: { state: PROMOTION_STATE.APPROVED, decidedById: approverId, decidedAt: new Date() },
    });
    await tx.collaborationEvent.create({
      data: {
        workspaceId, actorId: approverId, type: AUTONOMY_EVENT.GRANTED,
        subjectType: PROMOTION_SUBJECT_TYPE, subjectId: pattern.id,
        // Frozen BY VALUE. Following `promotedRuleId` a month from now would
        // answer a different question than the one this record exists to answer.
        detail: promotionSnapshot({
          pattern, rule: created,
          gate: {
            requestId: request.id, requestedById: request.requestedById,
            approvedById: approverId, selfApproved,
            minAccuracyApplied: PROMOTE_MIN_ACCURACY,
            requestedAt: request.createdAt, decidedAt: new Date(),
          },
        }),
      },
    });
    return created;
  });

  logger.info({ workspaceId, requestId, patternId: pattern.id, ruleId: rule.id, selfApproved },
    '[PromotionService] autonomy granted');
  return { state: PROMOTION_STATE.APPROVED, ruleId: rule.id };
}

// ─────────────────────────────────────────────────────────────
// 3 · REVOKE
// ─────────────────────────────────────────────────────────────
/**
 * Withdraw a rule's authority.
 *
 * Four writes, one transaction:
 *   · the rule is DISABLED and stamped — never deleted. The grant that created
 *     it stays in the audit log exactly as it was written.
 *   · `promotedRuleId` is cleared, so the pattern becomes promotable again. A
 *     later promotion is a NEW authorization producing a NEW rule, not the old
 *     one revived — which is what keeps the audit chain readable.
 *   · the episodes this rule was holding open are closed ADMINISTRATIVELY.
 *   · the withdrawal is recorded against the same subject as the grant.
 *
 * The closure is the delicate part. `enabled: false` alone would already stop
 * the sweep (it loads `enabled: true`), and C-02 guarantees the open episodes
 * would then survive untouched, because a pair that was never evaluated is
 * never closed. So closing them is a deliberate act, and it must not claim
 * anything about the account:
 *
 *   · `closureReason: RULE_REVOKED` — we stopped asking; the breach was not
 *     judged to have ended.
 *   · `resolution` is NOT written. `decisionLearning` admits a row on
 *     `resolution IS NOT NULL` plus an intervention stamp, so writing one would
 *     enrol every breach this rule was holding into institutional memory as a
 *     SUCCESS — teaching Lumi that switching a rule off improved the account.
 *   · no provenance stamp, for the same reason: nobody intervened.
 *   · `status: 'PROPOSED'` in the predicate. A decision a human already
 *     executed or dismissed is a claim that person made, and revoking a rule is
 *     not a licence to restate it.
 *
 * @param {string} workspaceId
 * @param {{ ruleId: string, actorId: string }} input
 * @returns {Promise<{ ruleId: string, episodesClosed: number }>}
 */
export async function revokePromotion(workspaceId, { ruleId, actorId } = {}) {
  if (!workspaceId) throw new Error('revokePromotion: workspaceId required');
  if (!ruleId)      throw new Error('revokePromotion: ruleId required');
  if (!actorId)     throw refuse('ActorUnresolved', 'actorId is required to revoke a promotion.');

  const rule = await prisma.guardrailRule.findFirst({ where: { id: ruleId, workspaceId } });
  if (!rule) throw refuse('NotFound', 'Rule not found in this workspace.');
  if (rule.revokedAt) throw refuse('AlreadyRevoked', 'This rule has already been revoked.');

  const now = new Date();

  const episodesClosed = await prisma.$transaction(async (tx) => {
    await tx.guardrailRule.update({ where: { id: rule.id }, data: { enabled: false, revokedAt: now } });

    // updateMany, not update: a rule promoted before C-05 has no sourcePatternId
    // to look up, and the pattern is still reachable by the link it holds.
    await tx.accountPattern.updateMany({
      where: { workspaceId, promotedRuleId: rule.id },
      data:  { promotedRuleId: null },
    });

    const closed = await tx.decision.updateMany({
      where: {
        workspaceId, guardrailRuleId: rule.id,
        status: 'PROPOSED', openHitKey: { not: null },
      },
      data: {
        status: 'RESOLVED', resolvedAt: now,
        closureReason: 'RULE_REVOKED',
        // Releasing the key IS the close, exactly as in the natural path.
        openHitKey: null,
      },
    });

    await tx.collaborationEvent.create({
      data: {
        workspaceId, actorId, type: AUTONOMY_EVENT.REVOKED,
        subjectType: PROMOTION_SUBJECT_TYPE,
        // A rule promoted before C-05 (or authored by hand) has no pattern to
        // hang its history on. Inventing one would attribute it to a belief that
        // never produced it, so it becomes its own subject.
        subjectId: rule.sourcePatternId ?? rule.id,
        detail: {
          ruleId: rule.id, ruleName: rule.name,
          sourcePatternId: rule.sourcePatternId ?? null,
          episodesClosed: closed.count, revokedAt: now.toISOString(),
        },
      },
    });

    return closed.count;
  });

  logger.info({ workspaceId, ruleId, episodesClosed }, '[PromotionService] autonomy revoked');
  return { ruleId: rule.id, episodesClosed };
}
