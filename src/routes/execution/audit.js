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

    try {
      const where = {
        workspaceId,
        ...(status && { status }),
        ...(actionType && { actionType }),
      };

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { performedAt: 'desc' },
        skip: parseInt(String(offset), 10),
        take: parseInt(String(limit), 10),
      });

      const total = await prisma.auditLog.count({ where });

      logger.info(`[ExecutionRouter] Audit query`, {
        workspaceId,
        userId,
        count: logs.length,
        total,
      });

      return res.json({
        logs,
        total,
        limit: parseInt(String(limit), 10),
        offset: parseInt(String(offset), 10),
      });
    } catch (err) {
      logger.error('[ExecutionRouter] Audit query failed', {
        workspaceId,
        error: err.message,
      });

      return res.status(500).json({
        error: 'Failed to retrieve audit logs',
        code: 'AUDIT_QUERY_ERROR',
      });
    }
  });
}
