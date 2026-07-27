// ============================================================
// adminAudit — the operator-panel action log
// ------------------------------------------------------------
// Every /api/admin/* mutation records one row here. The panel is the only
// cross-workspace surface in the product and the only one that can strand or
// destroy a workspace, so "who did this, and when" needs to outlive the
// process log.
//
// BEST-EFFORT BY CONSTRUCTION. A logging failure must never turn a working
// admin action into a 500, and must never be visible to the caller. Every
// throw — a missing table before the migration lands, a dead connection, a
// mocked-out prisma client in a test — is caught and warned. That also means
// this must NOT be awaited inside a transaction with the operation it records:
// swallowing the error there would still poison the surrounding tx.
// ============================================================
import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

/**
 * Record one admin-panel action. Never throws; always resolves.
 *
 * @param {object}  opts
 * @param {string}  opts.actorUid     req.userId — the Firebase uid
 * @param {string} [opts.actorEmail]  req.user?.email; falls back to 'unknown'
 * @param {'CHANGE_ROLE'|'CHANGE_PLAN'|'SEED_DEMO'|'DELETE_DEMO'} opts.type
 * @param {'USER'|'WORKSPACE'} opts.targetType
 * @param {string}  opts.targetId
 * @param {string} [opts.workspaceId] plain text; may name a deleted workspace
 * @param {object} [opts.before]      state before the change
 * @param {object} [opts.after]       state after the change
 * @returns {Promise<boolean>} true iff the row was written
 */
export async function recordAdminAction(opts = {}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorUid: opts.actorUid,
        actorEmail: opts.actorEmail ?? 'unknown',
        type: opts.type,
        targetType: opts.targetType,
        targetId: opts.targetId,
        workspaceId: opts.workspaceId ?? null,
        before: opts.before ?? null,
        after: opts.after ?? null,
      },
    });
    return true;
  } catch (err) {
    // The action itself already succeeded — say so plainly rather than
    // pretending the audit trail is complete.
    logger.warn(
      { err: err?.message, type: opts.type, targetId: opts.targetId, actorUid: opts.actorUid },
      '[adminAudit] action NOT recorded',
    );
    return false;
  }
}
