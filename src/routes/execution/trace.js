// ============================================================
// GET /api/execute/:id/trace — Deterministic execution timeline
// ============================================================
// Returns the full ordered event timeline for a single execution,
// reconstructed from ExecutionTransition records + live graph events.
//
// Use this to answer: "Why did node X get SKIPPED three days ago?"
//
// READ-ONLY. Never mutates execution state.
// ============================================================
import { logger }         from '../../utils/logger.js';
import { buildTrace }     from '../../services/execution-engine/observability/executionTrace.js';
import { serializeTrace } from '../../services/execution-engine/observability/traceSerializer.js';

export function registerTraceRoute(router) {
  router.get('/:id/trace', async (req, res) => {
    const workspaceId = req.workspaceId;
    const { id: executionId } = req.params;

    try {
      const trace = await buildTrace(executionId, workspaceId);

      if (!trace) {
        return res.status(404).json({
          error: 'Execution not found',
          code:  'EXECUTION_NOT_FOUND',
        });
      }

      logger.debug(
        { executionId, workspaceId, events: trace.timeline.length },
        '[Trace] served',
      );

      return res.json(serializeTrace(trace));
    } catch (err) {
      logger.error(
        { err: err.message, executionId, workspaceId },
        '[Trace] failed',
      );
      return res.status(500).json({
        error: 'Failed to retrieve execution trace',
        code:  'TRACE_FETCH_ERROR',
      });
    }
  });
}
