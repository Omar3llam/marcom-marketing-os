// ============================================================
// ApprovalService — plan/reallocation approvals + handoffs (audited)
// ============================================================
// Owns DB I/O. Acceptance #3: a strategist's plan/reallocation can require an
// approval before a buyer executes it; every request, decision, and handoff
// writes a CollaborationEvent — "all in the audit log."
//
//   requestApproval():  set Plan.requiresApproval + approvalState=PENDING,
//                       create the ApprovalRequest, audit APPROVAL_REQUESTED.
//   decideApproval():   ONE $transaction — ApprovalRequest → APPROVED/REJECTED,
//                       reflect onto Plan.approvalState, audit APPROVAL_DECIDED.
//                       Approval is what unblocks the existing Phase-3 promote.
//   handoff():          record a strategist→buyer (or escalate-back) handoff.
//   isExecutionBlocked(): a buyer cannot promote/execute a plan while PENDING.
//
// Reuses the ArtifactApproval/concludeTest precedent (request → decision →
// reviewerId → audit). roleScope enforces WHO may approve/handoff.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { WORKSPACE_ROLE, asKnownRole, canApprove, canHandoffTo, normalizeRole } from './roleScope.js';

export const APPROVAL_STATE = Object.freeze({ PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' });

/**
 * Pure: map an approval decision to its CollaborationEvent shape.
 * Exported for unit testing without a DB.
 */
export function approvalToEvent({ workspaceId, approverId, request, decision }) {
  if (!workspaceId) throw new Error('approvalToEvent: workspaceId required');
  return {
    workspaceId,
    actorId: approverId ?? null,
    type: 'APPROVAL_DECIDED',
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    detail: { requestId: request.id, decision, planId: request.planId ?? null },
  };
}

/** Open an approval gate on a plan (opt-in). Audited APPROVAL_REQUESTED. */
export async function requestApproval(workspaceId, { planId, subjectType = 'PLAN', subjectId, requestedById } = {}) {
  if (!workspaceId) throw new Error('requestApproval: workspaceId required');
  const subject = subjectId ?? planId;
  if (!subject) throw new Error('requestApproval: planId or subjectId required');

  return prisma.$transaction(async (tx) => {
    if (planId) {
      await tx.plan.update({ where: { id: planId }, data: { requiresApproval: true, approvalState: APPROVAL_STATE.PENDING } });
    }
    const request = await tx.approvalRequest.create({
      data: { workspaceId, planId: planId ?? null, subjectType, subjectId: subject, requestedById, state: APPROVAL_STATE.PENDING },
    });
    await tx.collaborationEvent.create({
      data: { workspaceId, actorId: requestedById ?? null, type: 'APPROVAL_REQUESTED', subjectType, subjectId: subject, detail: { requestId: request.id, planId: planId ?? null } },
    });
    logger.info({ workspaceId, requestId: request.id, planId }, '[ApprovalService] approval requested');
    return request;
  });
}

/**
 * Decide an approval. Only a STRATEGIST may approve (roleScope.canApprove).
 * Reflects onto Plan.approvalState and audits APPROVAL_DECIDED — atomically.
 */
export async function decideApproval(workspaceId, { requestId, decision, approverId, approverRole, reason } = {}) {
  if (!workspaceId) throw new Error('decideApproval: workspaceId required');
  if (decision !== APPROVAL_STATE.APPROVED && decision !== APPROVAL_STATE.REJECTED) {
    throw new Error("decideApproval: decision must be 'APPROVED' or 'REJECTED'");
  }
  if (!canApprove(approverRole)) {
    const err = new Error('decideApproval: only a STRATEGIST may approve');
    err.code = 'RoleForbidden';
    throw err;
  }

  const request = await prisma.approvalRequest.findFirst({ where: { id: requestId, workspaceId } });
  if (!request) throw new Error('decideApproval: request not found');
  if (request.state !== APPROVAL_STATE.PENDING) throw new Error(`decideApproval: request already ${request.state}`);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.approvalRequest.update({
      where: { id: request.id },
      data: { state: decision, decidedById: approverId ?? null, reason: reason ?? null, decidedAt: new Date() },
    });
    if (request.planId) {
      await tx.plan.update({ where: { id: request.planId }, data: { approvalState: decision } });
    }
    await tx.collaborationEvent.create({ data: approvalToEvent({ workspaceId, approverId, request, decision }) });
    logger.info({ workspaceId, requestId, decision }, '[ApprovalService] approval decided — audited');
    return updated;
  });
}

/**
 * A buyer cannot promote/execute a plan that still requires approval and has
 * not been APPROVED. Strategists are not gated by their own approval flow.
 */
export async function isExecutionBlocked(workspaceId, planId, role) {
  if (!planId) return false;
  if (normalizeRole(role) === WORKSPACE_ROLE.STRATEGIST) return false;
  const plan = await prisma.plan.findFirst({ where: { id: planId, workspaceId }, select: { requiresApproval: true, approvalState: true } });
  if (!plan) return false;
  return plan.requiresApproval === true && plan.approvalState !== APPROVAL_STATE.APPROVED;
}

/** Hand a verdict/plan from one role to another for execution. Audited. */
export async function handoff(workspaceId, { subjectType = 'DECISION', subjectId, fromRole, toRole, actorId, note } = {}) {
  if (!workspaceId) throw new Error('handoff: workspaceId required');
  if (!subjectId) throw new Error('handoff: subjectId required');
  const sourceRole = asKnownRole(fromRole);
  const destinationRole = asKnownRole(toRole);
  if (!sourceRole || !destinationRole || !canHandoffTo(sourceRole, destinationRole)) {
    const err = new Error(`handoff: ${fromRole}→${toRole} is not a legal handoff`);
    err.code = 'RoleForbidden';
    throw err;
  }
  const event = await prisma.collaborationEvent.create({
    data: {
      workspaceId, actorId: actorId ?? null, type: 'HANDOFF',
      subjectType, subjectId, fromRole: sourceRole, toRole: destinationRole,
      detail: note ? { note } : undefined,
    },
  });
  logger.info({ workspaceId, subjectId, fromRole: sourceRole, toRole: destinationRole }, '[ApprovalService] handoff recorded');
  return event;
}

export async function listApprovals(workspaceId, { state } = {}) {
  if (!workspaceId) throw new Error('listApprovals: workspaceId required');
  // Include just enough plan context for the reviewer's queue to render a row
  // (name/period/budget) without a second round-trip. The request itself stays
  // the source of truth for state/reason/requestedById/timestamps.
  return prisma.approvalRequest.findMany({
    where: { workspaceId, ...(state ? { state } : {}) },
    orderBy: { createdAt: 'desc' }, take: 50,
    include: { plan: { select: { id: true, name: true, periodStart: true, periodEnd: true, totalBudgetMinor: true, currency: true, status: true } } },
  });
}
