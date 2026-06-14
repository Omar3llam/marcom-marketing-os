// ============================================================
// MARCOM / Lumi — Rollback handler
// POST /api/lumi/rollback/:actionId
// Extracted from lumi.js for architecture size compliance.
// ============================================================
import { Router }        from 'express';
import { prisma }        from '../../lib/prisma.js';
import { enqueueAction } from '../../queues/index.js';
import { logger }        from '../../utils/logger.js';

export const rollbackRouter = Router();

// Rollback window: an action becomes immutable after 24h.
const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
rollbackRouter.post('/:actionId', async (req, res) => {
  const { actionId } = req.params;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (req.userRole !== 'ADMIN') {
    logger.warn({ actionId, userId: req.userId, userRole: req.userRole }, '[lumi/rollback] forbidden');
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Resolve Prisma User record — AuditLog.userId expects User.id (UUID), not Firebase uid
    const userRecord = await prisma.user.findUnique({
      where:  { clerkId: req.userId },
      select: { id: true },
    });
    if (!userRecord) {
      return res.status(401).json({ error: 'User record not found' });
    }

    const action = await prisma.action.findUnique({
      where:   { id: actionId },
      include: {
        auditLogs: { orderBy: { performedAt: 'desc' }, take: 1 },
      },
    });

    if (!action) return res.status(404).json({ error: 'Action not found' });

    // Workspace isolation — return 404 to avoid leaking that action exists
    if (action.workspaceId !== req.workspaceId) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // ── Status & window enforcement ─────────────────────────
    if (action.status !== 'EXECUTED_SUCCESS') {
      return res.status(409).json({
        error: 'NotRollbackable',
        reason: `status is ${action.status}; only EXECUTED_SUCCESS can be rolled back`,
      });
    }
    if (!action.executedAt) {
      return res.status(409).json({ error: 'NotRollbackable', reason: 'no executedAt' });
    }
    const ageMs = Date.now() - new Date(action.executedAt).getTime();
    if (ageMs > ROLLBACK_WINDOW_MS) {
      return res.status(410).json({
        error:  'RollbackWindowExpired',
        reason: `executed ${Math.round(ageMs / 3_600_000)}h ago; window is 24h`,
      });
    }

    const lastAudit = action.auditLogs[0];
    const previousState = lastAudit?.previousState ?? {};

    // ── Build inverse payload ────────────────────────────────
    const inversePayload = invertPayload(action.payload, previousState);

    // Extract audit metadata from original action payload
    const { platform, actionType } = extractAuditMetadata(action.payload);

    const inverse = await prisma.$transaction(async (tx) => {
      const created = await tx.action.create({
        data: {
          workspaceId:    action.workspaceId,
          campaignId:     action.campaignId,
          idempotencyKey: `rollback:${action.id}:${Date.now()}`,
          status:         'PENDING',
          payload:        inversePayload,
        },
      });
      await tx.action.update({
        where: { id: action.id },
        data:  { status: 'ROLLED_BACK' },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: action.workspaceId,
          userId:      userRecord.id,
          actionId:    action.id,
          actionType,
          targetId:    action.campaignId,
          platform,
          status:      'SUCCESS',
          payload: {
            rollback: true,
            originalActionId: action.id,
            inverseActionId:  created.id,
            performedBy: `user:${req.userId}`,
          },
        },
      });
      return created;
    });

    await enqueueAction(inverse);

    return res.json({
      ok:               true,
      rolledBackAction: action.id,
      inverseActionId:  inverse.id,
      enqueued:         true,
    });

  } catch (err) {
    logger.error({ err: err.message, actionId, userId: req.userId }, '[lumi/rollback] failed');
    return res.status(500).json({ error: 'RollbackFailed', message: 'Request failed' });
  }
});

// Build the inverse of a payload. Conservative: only known kinds
// are inverted; everything else uses `previousState` as the diff.
function invertPayload(payload, previousState) {
  const kind = payload?.kind;
  switch (kind) {
    case 'meta.pause_ad':    return { ...payload, kind: 'meta.resume_ad' };
    case 'meta.resume_ad':   return { ...payload, kind: 'meta.pause_ad' };
    case 'meta.scale_budget':
      return {
        ...payload,
        kind: 'meta.scale_budget',
        newBudget: previousState?.payload?.newBudget ?? payload?.previousBudget,
        previousBudget: payload?.newBudget,
      };
    case 'google.pause_keyword': return { ...payload, kind: 'google.resume_keyword' };
    case 'google.resume_keyword':return { ...payload, kind: 'google.pause_keyword' };
    default:
      return { kind: 'restore_state', restore: previousState, originalKind: kind };
  }
}

// Extract platform and actionType from payload for AuditLog
function extractAuditMetadata(payload) {
  const kind = payload?.kind || '';

  // Derive platform from payload.kind prefix
  let platform = 'UNKNOWN';
  if (kind.startsWith('meta.')) platform = 'META';
  else if (kind.startsWith('google.')) platform = 'GOOGLE';

  // Map payload.kind to ActionType enum values
  let actionType = 'OPTIMIZE_CAMPAIGN'; // fallback
  if (kind.includes('pause_ad') || kind.includes('pause')) actionType = 'PAUSE_ADSET';
  else if (kind.includes('resume_ad') || kind.includes('resume')) actionType = 'RESUME_ADSET';
  else if (kind.includes('scale') || kind.includes('budget')) actionType = 'SCALE_CAMPAIGN';

  return { platform, actionType };
}
