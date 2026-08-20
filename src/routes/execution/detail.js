// ============================================================
// GET /api/execute/:id — one execution, and the decision it carries out
// ============================================================
// R13-D / B3-B. The other half of the read contract.
//
// #403 shipped Decision → executions. This is executions → Decision, and until
// now it did not exist anywhere: `ExecutionRequest.decisionId` was written by
// the producer, carried forward by retry, indexed on the model — and projected
// by zero read routes. `/active`, `/:id/transitions`, `/:id/incident` and
// `/:id/trace` all select around it. So an operator holding an executionId
// could see that a mutation happened and never learn which call prompted it.
//
// TWO WORKSPACE PREDICATES, and they are not redundant:
//
//   1. on the ExecutionRequest — this reader may only see their own executions;
//   2. on the Decision         — the FK on `decisionId` targets `decisions.id`
//                                alone and carries no tenant component, so the
//                                database itself would happily join a row from
//                                another workspace. Nothing but this predicate
//                                stands between a cross-tenant `decisionId` and
//                                another workspace's verdict and entity id.
//
// Both are `findFirst({ where: { id, workspaceId } })` — a real query predicate,
// not a fetch-then-compare in JavaScript. That distinction matters for more
// than style: a predicate is what a mutation control can delete and a test can
// catch.
//
// 404, never 403, for another workspace's execution: the same answer a
// nonexistent id gets, so the response cannot be used to discover which ids
// are real.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import {
  toExecutionDetail,
  EXECUTION_DETAIL_SELECT,
} from '../../services/execution/executionProjection.js';
import { PROVENANCE_SELECT } from '../../services/execution/decisionProvenance.js';

// The roles that may queue a mutation (routes/execution/meta.js) are the roles
// that may read the mutation log. A CLIENT seat cannot execute and has no
// business reading what was executed.
const OPERATORS = [WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST];

export function registerDetailRoute(router) {
  // MUST be registered after every literal single-segment path (`/audit`,
  // `/vitals`, `/active`, `/paused`) or it will shadow them.
  router.get('/:id', requireCollabRole(...OPERATORS), async (req, res) => {
    const workspaceId = req.workspaceId;
    const { id } = req.params;

    if (!workspaceId) {
      return res.status(400).json({ error: 'No workspace resolved', code: 'NO_WORKSPACE' });
    }

    try {
      const execution = await prisma.executionRequest.findFirst({
        where:  { id, workspaceId },
        select: EXECUTION_DETAIL_SELECT,
      });

      if (!execution) {
        return res.status(404).json({ error: 'Execution not found', code: 'EXECUTION_NOT_FOUND' });
      }

      // Ascending: lifecycleTimestamps takes the EARLIEST entry per status, and
      // reading them in order is how the timeline reads to a human too.
      const transitions = await prisma.executionTransition.findMany({
        where:   { executionId: id, workspaceId },
        select:  { toStatus: true, createdAt: true, metadata: true },
        orderBy: { createdAt: 'asc' },
        take:    100,
      });

      // Resolved only when the row names one. An unattributed execution is a
      // normal path — an operator may act on a campaign no sweep has judged —
      // and it reports `decision: null` rather than inventing an attribution.
      const decision = execution.decisionId
        ? await prisma.decision.findFirst({
          where:  { id: execution.decisionId, workspaceId },
          select: {
            id: true, entityId: true, entityLevel: true,
            verdict: true, status: true, dismissedAt: true,
            // B4-A — both provenance columns, so the projection can name which
            // kind of execution happened rather than publishing one ambiguous
            // timestamp.
            ...PROVENANCE_SELECT,
          },
        })
        : null;

      return res.json({
        workspaceId,
        generatedAt: new Date().toISOString(),
        ...toExecutionDetail({ execution, transitions, decision }),
      });
    } catch (err) {
      logger.error({ err: err.message, workspaceId, executionId: id }, '[execution/detail] read failed');
      // 500, never a null-ish body: "this execution has no decision" is a
      // statement about the row, and our own failure must not be able to make it.
      return res.status(500).json({
        error: 'Failed to retrieve execution',
        code:  'EXECUTION_FETCH_ERROR',
      });
    }
  });
}
