// ============================================================
// GET /api/execute/audit — Execution audit trail
// ============================================================
// Query params:
//   - limit:      default 50
//   - offset:     default 0
//   - status:     'SUCCESS' | 'FAILED' | 'PENDING'
//   - actionType: filter by action type
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

export function registerAuditRoute(router) {
  router.get('/audit', async (req, res) => {
    const workspaceId = req.workspaceId;
    const userId      = req.userId;
    const { limit = 50, offset = 0, status, actionType } = req.query;
    // Clamp pagination: NaN ("?limit=abc") or negatives would make Prisma
    // throw a 500 on take/skip. Defaults survive; ceiling caps the page size.
    const take = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
    const skip = Math.max(parseInt(String(offset), 10) || 0, 0);

    try {
      const where = {
        workspaceId,
        ...(status && { status }),
        ...(actionType && { actionType }),
      };

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { performedAt: 'desc' },
        skip,
        take,
        // ── THE PROJECTION IS DECLARED, not inherited ───────────────────
        // This read had no `select`, and Prisma's default projection is every
        // scalar column. So the response was "whatever AuditLog happens to
        // hold" — and the day a migration adds a column, that column ships
        // from this endpoint, with nobody editing the schema having any reason
        // to open this file.
        //
        // The list below is TODAY'S CONTRACT, UNCHANGED. Slice C closes a
        // widening risk; it does not decide what the audit contract should
        // contain, so no consumer loses a field it already receives. Narrowing
        // this — dropping `payload`, say — is a separate product ruling.
        //
        // Changing the audit response should now take a decision here, rather
        // than a migration somewhere else.
        select: {
          id:           true,
          workspaceId:  true,
          userId:       true,
          actionId:     true,
          actionType:   true,
          targetId:     true,
          platform:     true,
          status:       true,
          payload:      true,
          response:     true,
          errorMessage: true,
          performedAt:  true,
        },
      });

      const total = await prisma.auditLog.count({ where });

      logger.info({
        workspaceId,
        userId,
        count: logs.length,
        total,
      }, `[ExecutionRouter] Audit query`);

      return res.json({
        logs,
        total,
        limit: take,
        offset: skip,
      });
    } catch (err) {
      logger.error({
        workspaceId,
        error: err.message,
      }, '[ExecutionRouter] Audit query failed');

      return res.status(500).json({
        error: 'Failed to retrieve audit logs',
        code: 'AUDIT_QUERY_ERROR',
      });
    }
  });
}
