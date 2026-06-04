// ============================================================
// GET /api/execute/:id/incident — Incident forensics
// ============================================================
// Returns transition chain plus a derived incident summary
// (winner/loser collision detection, telemetry projection).
// Powers Operations · Incident Panel.
//
// Only returns a meaningful `incident` block when the execution
// is in a failure terminal state (EXECUTED_FAILED, TIMED_OUT).
// For successful or in-flight executions the block is null.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { IN_FLIGHT_STATUSES, FAILURE_STATUSES } from '@marcom/runtime-contracts';
import { loadExecutionForWorkspace } from './_helpers.js';

/**
 * Derive an incident summary from a transition chain.
 *
 * Returns null when the execution did not fail. Otherwise produces:
 *   {
 *     title: "FAILED at v<N>",
 *     cause: <reason from failing transition or fallback>,
 *     winner: <actor that drove the terminal failure>,
 *     loser:  <actor of the in-flight transition just before failure>,
 *     telemetry: [{ tag, value, tone }, ...],
 *     graph: { from, winner, loser, resolution }
 *   }
 *
 * The winner/loser pair captures collision semantics: the in-flight
 * worker (loser) lost the race when a supervisor/timeout actor
 * (winner) drove the execution to a terminal failure state.
 */
function buildIncidentSummary(execution, transitions) {
  if (!FAILURE_STATUSES.includes(execution.status)) return null;
  if (transitions.length === 0) return null;

  const failingIdx = transitions.findIndex((t) => FAILURE_STATUSES.includes(t.toStatus));
  if (failingIdx === -1) return null;

  const failing = transitions[failingIdx];
  let loser = null;
  for (let i = failingIdx - 1; i >= 0; i--) {
    if (IN_FLIGHT_STATUSES.includes(transitions[i].toStatus)) {
      loser = transitions[i].actor;
      break;
    }
  }

  const winner = failing.actor;
  const retries = transitions.filter((t) => t.toStatus === 'RETRYING').length;
  const occConflicts = transitions.filter((t) => t.metadata && t.metadata.occConflict).length;
  const lastInFlight = transitions
    .filter((t) => IN_FLIGHT_STATUSES.includes(t.toStatus))
    .pop();

  const telemetry = [
    {
      tag: 'occ_conflict',
      value: occConflicts > 0 ? `${occConflicts} detected at v=${failing.newVersion}` : 'none recorded',
      tone: occConflicts > 0 ? 'kill' : 'neutral',
    },
    {
      tag: 'retry_count',
      value: retries > 0 ? `${retries} retr${retries === 1 ? 'y' : 'ies'} attempted` : 'no retries',
      tone: retries > 0 ? 'hold' : 'neutral',
    },
    {
      tag: 'lock_holder',
      value: loser && winner ? `${loser} → ${winner}` : (winner || '—'),
      tone: 'neutral',
    },
    {
      tag: 'correlation',
      value: execution.correlationId
        ? `${execution.correlationId} · ${transitions.length} step${transitions.length === 1 ? '' : 's'}`
        : 'no correlation id',
      tone: 'neutral',
    },
    {
      tag: 'last_known_state',
      value: lastInFlight
        ? `${lastInFlight.toStatus} (v=${lastInFlight.newVersion})`
        : `${failing.fromStatus} (v=${failing.previousVersion})`,
      tone: 'neutral',
    },
  ];

  return {
    title: `FAILED at v${failing.newVersion}`,
    cause: failing.reason || (execution.status === 'TIMED_OUT' ? 'timeout collision' : 'execution failure'),
    winner: winner || 'UNKNOWN',
    loser: loser || 'UNKNOWN',
    telemetry,
    graph: {
      from: failing.fromStatus,
      winner: winner || 'UNKNOWN',
      loser: loser || 'UNKNOWN',
      resolution: failing.toStatus,
    },
  };
}

export function registerIncidentRoute(router) {
  router.get('/:id/incident', async (req, res) => {
    const { id: executionId } = req.params;
    const workspaceId = req.workspaceId;
    const userId      = req.userId;

    try {
      const { execution } = await loadExecutionForWorkspace(executionId, workspaceId);

      if (!execution) {
        return res.status(404).json({
          error: 'Execution not found',
          code: 'NOT_FOUND',
        });
      }

      const transitions = await prisma.executionTransition.findMany({
        where: { executionId, workspaceId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          actor: true,
          previousVersion: true,
          newVersion: true,
          reason: true,
          metadata: true,
          correlationId: true,
          createdAt: true,
        },
      });

      const incident = buildIncidentSummary(execution, transitions);

      logger.debug({
        executionId,
        workspaceId,
        userId,
        hasIncident: incident !== null,
      }, '[ExecutionRouter] Incident projection');

      return res.json({ execution, transitions, incident });
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        logger.warn({ executionId, workspaceId, userId }, '[ExecutionRouter] Workspace mismatch (incident)');
        return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
      }
      logger.error('[ExecutionRouter] Incident fetch failed', {
        executionId,
        workspaceId,
        userId,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({
        error: 'Failed to fetch incident',
        code: 'INCIDENT_ERROR',
      });
    }
  });
}
