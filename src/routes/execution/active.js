// ============================================================
// GET /api/execute/active — Live in-flight monitor list
// ============================================================
// Lists in-flight executions for the requesting workspace,
// ordered by most recently updated. Powers Operations · Live Monitor.
//
// Response: { executions: [{ id, actionType, targetId, status,
//   version, actor, correlationId, createdAt, updatedAt,
//   ageSeconds }, ...], serverNow }
//
// `actor` is best-effort: derived from the most recent transition's
// actor field (defaults to 'SYSTEM' when no transitions exist yet).
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { IN_FLIGHT_STATUSES } from '@marcom/runtime-contracts';

export function registerActiveRoute(router) {
  router.get('/active', async (req, res) => {
    const workspaceId = req.workspaceId;
    const userId      = req.userId;

    try {
      const executions = await prisma.executionRequest.findMany({
        where: {
          workspaceId,
          status: { in: IN_FLIGHT_STATUSES },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          actionType: true,
          targetId: true,
          status: true,
          version: true,
          correlationId: true,
          createdAt: true,
          updatedAt: true,
          transitions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { actor: true },
          },
        },
      });

      const now = Date.now();
      const payload = executions.map((e) => ({
        id: e.id,
        actionType: e.actionType,
        targetId: e.targetId,
        status: e.status,
        version: e.version,
        actor: e.transitions[0]?.actor || 'SYSTEM',
        correlationId: e.correlationId,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        ageSeconds: Math.floor((now - new Date(e.updatedAt).getTime()) / 1000),
      }));

      logger.debug({
        workspaceId,
        userId,
        count: payload.length,
      }, '[ExecutionRouter] Active executions list');

      return res.json({ executions: payload, serverNow: new Date().toISOString() });
    } catch (err) {
      logger.error({
        workspaceId,
        userId,
        error: err.message,
        stack: err.stack,
      }, '[ExecutionRouter] Active list failed');
      return res.status(500).json({
        error: 'Failed to list active executions',
        code: 'ACTIVE_LIST_ERROR',
      });
    }
  });
}
