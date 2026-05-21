// ============================================================
// MARCOM / Lumi — Meta Execution Router
// ============================================================
// STRICT ENTERPRISE GUARDRAILS:
//   Layer 1: VALIDATION (allowed actions, target types)
//   Layer 2: IDEMPOTENCY (prevent duplicates via unique keys)
//   Layer 3: EXECUTION (call Meta API via service)
//   Layer 4: AUDIT LOGGING (log all outcomes)
//
// Every action is:
// - Multi-tenant scoped (workspaceId from auth context)
// - Validated before execution
// - Logged before returning to client
// - Idempotent (same key = replay stored response, no re-execution)
// ============================================================
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { executeMetaAction } from '../services/metaExecutionService.js';
import { firebaseAuthMiddleware } from '../middleware/firebaseAuth.js';
import { contextGuard } from '../middleware/contextGuard.js';
import { logger } from '../utils/logger.js';
import { broadcastWorkspaceEvent } from './events.js';
import { lifecycleService } from '../services/execution/ExecutionLifecycleService.js';
import { ExecutionStatus, TransitionActor } from '@marcom/runtime-contracts';
const router = Router();

// ── Constants ────────────────────────────────────────────

/** Map of allowed action types to valid target types */
const ALLOWED_ACTIONS = {
  PAUSE_CAMPAIGN: ['campaign'],
  RESUME_CAMPAIGN: ['campaign'],
  SCALE_CAMPAIGN: ['campaign'],
  OPTIMIZE_CAMPAIGN: ['campaign'],
  INCREASE_BUDGET: ['campaign', 'adset'],
  DECREASE_BUDGET: ['campaign', 'adset'],
  PAUSE_ADSET: ['adset'],
  RESUME_ADSET: ['adset'],
};

/** Idempotency: deduplicate based on unique keys, not time windows */

// ── Middleware ───────────────────────────────────────────

router.use(firebaseAuthMiddleware);
router.use(contextGuard);

// ── POST /api/execute/meta ───────────────────────────────

/**
 * Execute a Meta Ads action with strict enterprise guardrails.
 *
 * Request body:
 * {
 *   "actionType": "PAUSE_CAMPAIGN" | "INCREASE_BUDGET" | etc.,
 *   "targetId": "123456789",
 *   "targetType": "campaign" | "adset",
 *   "idempotencyKey": "uuid",  // Required for deduplication
 *   "options": { "amount": 5000 }  // Optional, action-dependent
 * }
 *
 * Response:
 * {
 *   "success": true|false,
 *   "idempotentReplay": boolean,  // true if replayed from cache
 *   "executionId": "uuid",
 *   "auditLogId": "uuid",
 *   "status": "EXECUTED_SUCCESS" | "EXECUTED_FAILED",
 *   "data": { ... },  // Meta API response
 *   "error": "..."    // If failed
 * }
 */
router.post('/meta', async (req, res) => {
  const { actionType, targetId, targetType, idempotencyKey, options } = req.body;
  const { userId, workspaceId } = req.user;

  try {
    // ═══════════════════════════════════════════════════════
    // LAYER 1: VALIDATION
    // ═══════════════════════════════════════════════════════
    const validationError = validateRequest(actionType, targetId, targetType, idempotencyKey);
    if (validationError) {
      logger.warn(`[ExecutionRouter] Validation failed`, {
        workspaceId,
        userId,
        actionType,
        targetId,
        reason: validationError,
      });

      // Create audit log for failed validation
      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId,
          actionType: actionType,
          targetId,
          platform: 'META',
          status: 'FAILED',
          errorMessage: validationError,
          payload: req.body,
        },
      });

      return res.status(400).json({
        success: false,
        error: validationError,
        code: 'VALIDATION_ERROR',
      });
    }

    // ═══════════════════════════════════════════════════════
    // LAYER 2: IDEMPOTENCY CHECK
    // ═══════════════════════════════════════════════════════
    const existingRequest = await prisma.executionRequest.findUnique({
      where: { idempotencyKey },
    });

    if (existingRequest) {
      // Idempotent replay: return previous response
      logger.info(`[ExecutionRouter] Idempotent replay`, {
        workspaceId,
        userId,
        actionType,
        targetId,
        idempotencyKey,
        executionId: existingRequest.id,
        status: existingRequest.status,
      });

      return res.status(200).json({
        success: existingRequest.status === 'EXECUTED_SUCCESS',
        idempotentReplay: true,
        executionId: existingRequest.id,
        status: existingRequest.status,
        ...(existingRequest.response && { data: existingRequest.response }),
        ...(existingRequest.status === 'FAILED' && existingRequest.response?.error && {
          error: existingRequest.response.error,
        }),
      });
    }

    // Create ExecutionRequest BEFORE execution
    const executionRequest = await prisma.executionRequest.create({
      data: {
        workspaceId,
        idempotencyKey,
        actionType,
        targetId,
        status: 'PENDING',
        payload: req.body,
      },
    });

    logger.info(`[ExecutionRouter] Created ExecutionRequest`, {
      executionId: executionRequest.id,
      idempotencyKey,
      workspaceId,
    });

    // ═══════════════════════════════════════════════════════
    // LAYER 3: EXECUTION (call Meta API)
    // ═══════════════════════════════════════════════════════

    // Broadcast: QUEUED
    broadcastWorkspaceEvent(workspaceId, {
      type: 'EXECUTION_STATUS',
      status: 'QUEUED',
      targetId,
      actionType,
      timestamp: new Date().toISOString(),
    });

    logger.info(`[ExecutionRouter] Starting execution`, {
      workspaceId,
      userId,
      actionType,
      targetId,
      targetType,
    });

    // Broadcast: EXECUTING
    broadcastWorkspaceEvent(workspaceId, {
      type: 'EXECUTION_STATUS',
      status: 'EXECUTING',
      targetId,
      actionType,
      timestamp: new Date().toISOString(),
    });

    const executionResult = await executeMetaAction(
      workspaceId,
      userId,
      actionType,
      targetId,
      options
    );

    // ═══════════════════════════════════════════════════════
    // LAYER 4: AUDIT LOGGING (always log the outcome)
    // ═══════════════════════════════════════════════════════
    const auditLog = await prisma.auditLog.create({
      data: {
        workspaceId,
        userId,
        actionType: actionType,
        targetId,
        platform: 'META',
        status: executionResult.success ? 'SUCCESS' : 'FAILED',
        payload: req.body,
        response: executionResult.success ? executionResult.data : null,
        errorMessage: executionResult.success ? null : executionResult.error,
      },
    });

    logger.info(`[ExecutionRouter] Execution completed`, {
      workspaceId,
      userId,
      actionType,
      targetId,
      success: executionResult.success,
      auditLogId: auditLog.id,
    });

    // ─────────────────────────────────────────────────────
    // Broadcast: SUCCESS or FAILED
    // ─────────────────────────────────────────────────────
    if (executionResult.success) {
      broadcastWorkspaceEvent(workspaceId, {
        type: 'EXECUTION_STATUS',
        status: 'EXECUTED_SUCCESS',
        targetId,
        actionType,
        auditLogId: auditLog.id,
        timestamp: new Date().toISOString(),
      });
    } else {
      broadcastWorkspaceEvent(workspaceId, {
        type: 'EXECUTION_STATUS',
        status: 'EXECUTED_FAILED',
        targetId,
        actionType,
        auditLogId: auditLog.id,
        error: executionResult.error,
        timestamp: new Date().toISOString(),
      });
    }

    // ─────────────────────────────────────────────────────
    // Update ExecutionRequest with result
    // ─────────────────────────────────────────────────────
    const finalStatus = executionResult.success ? 'EXECUTED_SUCCESS' : 'FAILED';
    await prisma.executionRequest.update({
      where: { id: executionRequest.id },
      data: {
        status: finalStatus,
        response: executionResult.success
          ? executionResult.data
          : { error: executionResult.error, code: executionResult.code },
      },
    });

    // ─────────────────────────────────────────────────────
    // Return response to client
    // ─────────────────────────────────────────────────────
    if (executionResult.success) {
      return res.status(200).json({
        success: true,
        idempotentReplay: false,
        executionId: executionRequest.id,
        auditLogId: auditLog.id,
        status: finalStatus,
        data: executionResult.data,
        message: `${actionType} executed successfully on Meta`,
      });
    } else {
      return res.status(400).json({
        success: false,
        idempotentReplay: false,
        executionId: executionRequest.id,
        auditLogId: auditLog.id,
        status: finalStatus,
        error: executionResult.error,
        code: executionResult.code,
        message: `${actionType} failed: ${executionResult.error}`,
      });
    }
  } catch (err) {
    logger.error(`[ExecutionRouter] Unhandled error`, {
      workspaceId,
      userId,
      actionType,
      targetId,
      error: err.message,
      stack: err.stack,
    });

    // Attempt to log the error to audit log
    try {
      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId,
          actionType: actionType,
          targetId,
          platform: 'META',
          status: 'FAILED',
          errorMessage: err.message,
          payload: req.body,
        },
      });
    } catch (logErr) {
      logger.error('[ExecutionRouter] Failed to create audit log', { error: logErr.message });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error during execution',
      code: 'INTERNAL_ERROR',
    });
  }
});

// ── GET /api/execute/audit ──────────────────────────────

/**
 * Retrieve execution audit trail for a workspace.
 * Query params:
 *   - limit: default 50
 *   - offset: default 0
 *   - status: 'SUCCESS' | 'FAILED' | 'PENDING'
 *   - actionType: filter by action type
 */
router.get('/audit', async (req, res) => {
  const { workspaceId, userId } = req.user;
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

// ── GET /api/execute/:id/active ─────────────────────────

/**
 * Reconciliation Endpoint (Phase 11B Task 5)
 *
 * Backend authority for execution state.
 * Used by frontend after SSE disconnect / refresh / crash.
 *
 * Architecture Gate Decision 1:
 * - Backend reconciliation = single source of truth
 * - sessionStorage = transient optimization cache only
 * - SSE = best effort transport
 * - This endpoint = recovery authority
 *
 * Response format (ExecutionReconciliationPayload):
 * {
 *   "executionId": "...",
 *   "correlationId": "...",
 *   "status": "EXECUTING",
 *   "version": 12,
 *   "isTerminal": false,
 *   "updatedAt": "2026-05-20T...",
 *   "lastTransitionAt": "2026-05-20T...",
 *   "serverNow": "2026-05-20T...",
 *   "canResume": true,
 *   "isStale": false,
 *   "activeStep": "GENERATE_STRATEGY",
 *   "retryMetadata": { ... },
 *   "response": { ... }  // Only for terminal states
 * }
 *
 * IMPORTANT:
 * - Completely idempotent (no side effects)
 * - Read-only authority
 * - No implicit retries / auto-fix / hidden mutations
 * - Version field enables stale detection (incoming.version < local.version → DROP EVENT)
 */
router.get('/:id/active', async (req, res) => {
  const { id: executionId } = req.params;
  const { workspaceId, userId } = req.user;

  try {
    logger.debug({
      executionId,
      workspaceId,
      userId,
    }, '[ExecutionRouter] Reconciliation request');

    // Verify execution exists and belongs to workspace FIRST (security check)
    const execution = await prisma.executionRequest.findUnique({
      where: { id: executionId },
      select: { workspaceId: true },
    });

    if (!execution) {
      logger.warn({
        executionId,
        workspaceId,
        userId,
      }, '[ExecutionRouter] Execution not found');

      return res.status(404).json({
        error: 'Execution not found',
        code: 'NOT_FOUND',
      });
    }

    if (execution.workspaceId !== workspaceId) {
      logger.warn({
        executionId,
        workspaceId,
        executionWorkspaceId: execution.workspaceId,
        userId,
      }, '[ExecutionRouter] Workspace mismatch');

      return res.status(403).json({
        error: 'Access denied',
        code: 'FORBIDDEN',
      });
    }

    // Fetch execution state via lifecycle service
    const state = await lifecycleService.getExecutionState(executionId);

    logger.info({
      executionId,
      workspaceId,
      userId,
      status: state.status,
      version: state.version,
      isTerminal: state.isTerminal,
      isStale: state.isStale,
    }, '[ExecutionRouter] Reconciliation successful');

    return res.json(state);
  } catch (err) {
    logger.error('[ExecutionRouter] Reconciliation failed', {
      executionId,
      workspaceId,
      userId,
      error: err.message,
      stack: err.stack,
    });

    return res.status(500).json({
      error: 'Failed to fetch execution state',
      code: 'RECONCILIATION_ERROR',
    });
  }
});

// ─────────────────────────────────────────────────────────
// ── Operations Runtime Layer (Phase 11B Wiring) ──────────
// ─────────────────────────────────────────────────────────
// Three read-only endpoints powering the Operations panel:
//   GET /api/execute/active            — live in-flight grid
//   GET /api/execute/:id/transitions   — transition timeline
//   GET /api/execute/:id/incident      — incident forensics
//
// All workspace-scoped, no side effects, no implicit retries.
// ─────────────────────────────────────────────────────────

/** Statuses considered "in-flight" for the Live Monitor. */
const IN_FLIGHT_STATUSES = ['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING'];

/** Terminal failure statuses (for incident detection). */
const FAILURE_STATUSES = ['EXECUTED_FAILED', 'TIMED_OUT'];

/**
 * GET /api/execute/vitals
 *
 * Returns rolling runtime vitals for the requesting workspace. Powers
 * the Operations · RuntimeHealthStrip header.
 *
 * Response: {
 *   inFlightCount: number,    // current executions in PENDING/QUEUED/EXECUTING/RETRYING
 *   successPerHour: number,   // EXECUTED_SUCCESS in the last 60 minutes
 *   failedPerHour: number,    // EXECUTED_FAILED + TIMED_OUT in the last 60 minutes
 *   p95LatencyMs: number|null, // 95th percentile of terminal execution durations in last hour
 *   serverNow: ISOString,
 *   windowMinutes: 60,
 * }
 *
 * Notes:
 * - Read-only, no side effects.
 * - p95 computed in JS over a single Prisma fetch — the dataset is small
 *   (one hour of terminal executions per workspace). Switch to a raw SQL
 *   percentile_cont() if volume grows beyond ~10k/hour per workspace.
 */
router.get('/vitals', async (req, res) => {
  const { workspaceId, userId } = req.user;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  try {
    const [inFlightCount, successPerHour, failedPerHour, terminalDurations] = await Promise.all([
      prisma.executionRequest.count({
        where: { workspaceId, status: { in: IN_FLIGHT_STATUSES } },
      }),
      prisma.executionRequest.count({
        where: {
          workspaceId,
          status: 'EXECUTED_SUCCESS',
          updatedAt: { gte: oneHourAgo },
        },
      }),
      prisma.executionRequest.count({
        where: {
          workspaceId,
          status: { in: FAILURE_STATUSES },
          updatedAt: { gte: oneHourAgo },
        },
      }),
      prisma.executionRequest.findMany({
        where: {
          workspaceId,
          status: { in: ['EXECUTED_SUCCESS', ...FAILURE_STATUSES] },
          updatedAt: { gte: oneHourAgo },
        },
        select: { createdAt: true, updatedAt: true },
      }),
    ]);

    const p95LatencyMs = computeP95Latency(terminalDurations);

    logger.debug({
      workspaceId,
      userId,
      inFlightCount,
      successPerHour,
      failedPerHour,
      p95LatencyMs,
      sampleSize: terminalDurations.length,
    }, '[ExecutionRouter] Runtime vitals');

    return res.json({
      inFlightCount,
      successPerHour,
      failedPerHour,
      p95LatencyMs,
      serverNow: now.toISOString(),
      windowMinutes: 60,
    });
  } catch (err) {
    logger.error('[ExecutionRouter] Vitals fetch failed', {
      workspaceId,
      userId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: 'Failed to fetch runtime vitals',
      code: 'VITALS_ERROR',
    });
  }
});

/**
 * Compute the 95th percentile latency (in ms) from a list of executions
 * with createdAt + updatedAt fields. Returns null for empty input.
 *
 * Uses the linear-interpolation percentile method (nearest-rank with
 * fraction). For small samples this gives a stable, non-jittery vital.
 */
function computeP95Latency(records) {
  if (!records || records.length === 0) return null;

  const durations = records
    .map((r) => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime())
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);

  if (durations.length === 0) return null;
  if (durations.length === 1) return durations[0];

  const rank = 0.95 * (durations.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return Math.round(durations[lower] + (durations[upper] - durations[lower]) * weight);
}

/**
 * GET /api/execute/active
 *
 * Lists in-flight executions for the requesting workspace, ordered by
 * most recently updated. Powers the Operations · Live Monitor view.
 *
 * Response: { executions: [{ id, actionType, targetId, status, version,
 *   actor, correlationId, createdAt, updatedAt, ageSeconds }, ...] }
 *
 * `actor` is best-effort: derived from the most recent transition's actor
 * field (defaults to 'SYSTEM' when no transitions exist yet).
 */
router.get('/active', async (req, res) => {
  const { workspaceId, userId } = req.user;

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
    logger.error('[ExecutionRouter] Active list failed', {
      workspaceId,
      userId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: 'Failed to list active executions',
      code: 'ACTIVE_LIST_ERROR',
    });
  }
});

/**
 * Workspace-isolated lookup of an execution by id.
 * Returns null when not found, throws { code: 'FORBIDDEN' } on mismatch.
 */
async function loadExecutionForWorkspace(executionId, workspaceId) {
  const execution = await prisma.executionRequest.findUnique({
    where: { id: executionId },
    select: {
      id: true,
      workspaceId: true,
      actionType: true,
      targetId: true,
      status: true,
      version: true,
      correlationId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!execution) return { execution: null };
  if (execution.workspaceId !== workspaceId) {
    const err = new Error('Workspace mismatch');
    err.code = 'FORBIDDEN';
    throw err;
  }
  return { execution };
}

/**
 * GET /api/execute/:id/transitions
 *
 * Returns the ordered transition chain for an execution. Powers the
 * Operations · Execution Timeline view.
 *
 * Response: {
 *   execution: { id, actionType, status, version, correlationId, ... },
 *   transitions: [{ id, fromStatus, toStatus, actor, previousVersion,
 *     newVersion, reason, metadata, correlationId, createdAt }, ...]
 * }
 */
router.get('/:id/transitions', async (req, res) => {
  const { id: executionId } = req.params;
  const { workspaceId, userId } = req.user;

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

    logger.debug({
      executionId,
      workspaceId,
      userId,
      transitionCount: transitions.length,
    }, '[ExecutionRouter] Transitions fetched');

    return res.json({ execution, transitions });
  } catch (err) {
    if (err.code === 'FORBIDDEN') {
      logger.warn({ executionId, workspaceId, userId }, '[ExecutionRouter] Workspace mismatch (transitions)');
      return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
    }
    logger.error('[ExecutionRouter] Transitions fetch failed', {
      executionId,
      workspaceId,
      userId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: 'Failed to fetch transitions',
      code: 'TRANSITIONS_ERROR',
    });
  }
});

/**
 * GET /api/execute/:id/incident
 *
 * Returns transition chain plus a derived incident summary (winner/loser
 * collision detection, telemetry projection). Powers the Operations ·
 * Incident Panel view.
 *
 * Only returns a meaningful `incident` block when the execution is in a
 * failure terminal state (EXECUTED_FAILED, TIMED_OUT). For successful or
 * in-flight executions the block is null.
 */
router.get('/:id/incident', async (req, res) => {
  const { id: executionId } = req.params;
  const { workspaceId, userId } = req.user;

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

/**
 * Derive an incident summary from a transition chain.
 *
 * Returns null when the execution did not fail. Otherwise produces:
 *   {
 *     title: "FAILED at v<N>",
 *     cause: <reason from failing transition or fallback>,
 *     winner: <actor that drove the terminal failure>,
 *     loser:  <actor of the in-flight transition just before failure>,
 *     telemetry: [{ tag, value, tone }, ...]
 *   }
 *
 * The winner/loser pair captures collision semantics: the in-flight worker
 * (loser) lost the race when a supervisor/timeout actor (winner) drove the
 * execution to a terminal failure state.
 */
/** Statuses eligible for retry. Only failure terminals — retrying a
 *  CANCELLED is conceptually a "re-run", and retrying a success is a
 *  no-op, so both are excluded.
 */
const RETRYABLE_STATUSES = ['EXECUTED_FAILED', 'TIMED_OUT'];

/**
 * POST /api/execute/:id/retry
 *
 * Clones a failed execution into a new ExecutionRequest in QUEUED
 * status. Powers the "Retry from last known good" button in the
 * Operations · Incident Panel.
 *
 * Behavior:
 *   - Only executions in EXECUTED_FAILED / TIMED_OUT can be retried.
 *   - The new ExecutionRequest carries:
 *       * fresh idempotencyKey + executionId (cuid)
 *       * cloned actionType, targetId, payload from the original
 *       * preserved correlationId (lineage stays intact)
 *       * retryMetadata: { retryOf, retriedAt, retriedBy }
 *   - The new request is created in PENDING then immediately
 *     transitioned to QUEUED via the lifecycle service. That single
 *     transition emits the canonical audit log + SSE broadcast so
 *     the new row shows up in the Live Monitor in real time.
 *
 * Note: queueing is not the same as executing. This endpoint creates
 * a retry record and surfaces it; running it (synchronously like
 * POST /meta does, or via a dedicated ExecutionRequest worker) is a
 * separate concern.
 *
 * Response (201): {
 *   executionId, status: 'QUEUED', retryOf, correlationId, version
 * }
 */
router.post('/:id/retry', async (req, res) => {
  const { id: originalId } = req.params;
  const { workspaceId, userId } = req.user;

  try {
    const original = await prisma.executionRequest.findUnique({
      where: { id: originalId },
      select: {
        id: true,
        workspaceId: true,
        actionType: true,
        targetId: true,
        payload: true,
        status: true,
        correlationId: true,
      },
    });

    if (!original) {
      return res.status(404).json({
        error: 'Execution not found',
        code: 'NOT_FOUND',
      });
    }

    if (original.workspaceId !== workspaceId) {
      logger.warn({ originalId, workspaceId, executionWorkspaceId: original.workspaceId, userId },
        '[ExecutionRouter] Retry blocked by workspace mismatch');
      return res.status(403).json({
        error: 'Access denied',
        code: 'FORBIDDEN',
      });
    }

    if (!RETRYABLE_STATUSES.includes(original.status)) {
      return res.status(409).json({
        error: `Execution is not in a retryable state (current: ${original.status})`,
        code: 'NOT_RETRYABLE',
        retryableStatuses: RETRYABLE_STATUSES,
      });
    }

    // 1. Create clone in PENDING (the canonical initial state).
    const retriedAt = new Date().toISOString();
    const newRequest = await prisma.executionRequest.create({
      data: {
        workspaceId,
        idempotencyKey: crypto.randomUUID(),
        actionType: original.actionType,
        targetId: original.targetId,
        status: ExecutionStatus.PENDING,
        payload: original.payload,
        correlationId: original.correlationId,
        retryMetadata: {
          retryOf: original.id,
          retriedAt,
          retriedBy: userId,
        },
      },
      select: {
        id: true,
        workspaceId: true,
        version: true,
        correlationId: true,
      },
    });

    // 2. Transition PENDING → QUEUED via the lifecycle service.
    //    This is the audit + SSE moment: the Live Monitor will see
    //    the new row appear with a QUEUED pill in real time.
    let updated;
    try {
      updated = await lifecycleService.transition({
        executionId: newRequest.id,
        newStatus: ExecutionStatus.QUEUED,
        expectedVersion: newRequest.version,
        actor: TransitionActor.RETRY_POLICY,
        correlationId: original.correlationId,
        metadata: {
          reason: 'manual_retry',
          auditMetadata: {
            retryOf: original.id,
            retriedBy: userId,
          },
        },
      });
    } catch (transitionErr) {
      // The record exists but couldn't be promoted. Log + surface a
      // 500 so the operator sees the failure rather than a silent
      // PENDING ghost.
      logger.error('[ExecutionRouter] Retry transition failed', {
        originalId,
        newExecutionId: newRequest.id,
        workspaceId,
        userId,
        error: transitionErr.message,
      });
      return res.status(500).json({
        error: 'Retry created but could not be queued',
        code: 'RETRY_TRANSITION_FAILED',
        executionId: newRequest.id,
      });
    }

    logger.info({
      originalId,
      newExecutionId: newRequest.id,
      workspaceId,
      userId,
      correlationId: original.correlationId,
    }, '[ExecutionRouter] Retry queued');

    return res.status(201).json({
      executionId: newRequest.id,
      status: ExecutionStatus.QUEUED,
      retryOf: original.id,
      correlationId: original.correlationId,
      version: updated.version,
    });
  } catch (err) {
    logger.error('[ExecutionRouter] Retry failed', {
      originalId,
      workspaceId,
      userId,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: 'Failed to retry execution',
      code: 'RETRY_ERROR',
    });
  }
});

function buildIncidentSummary(execution, transitions) {
  if (!FAILURE_STATUSES.includes(execution.status)) return null;
  if (transitions.length === 0) return null;

  // Find the transition that entered a failure state.
  const failingIdx = transitions.findIndex((t) => FAILURE_STATUSES.includes(t.toStatus));
  if (failingIdx === -1) return null;

  const failing = transitions[failingIdx];
  // Loser = actor on the last in-flight transition before failure.
  // Walk backwards to find a transition whose toStatus is in-flight.
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

// ── Validation Helper ────────────────────────────────────

/**
 * Layer 1: Validate request format and action type.
 * Returns error string if invalid, null if valid.
 */
function validateRequest(actionType, targetId, targetType, idempotencyKey) {
  // Ensure idempotency key is provided
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return 'idempotencyKey is required and must be a non-empty string (use crypto.randomUUID() on client)';
  }

  // Ensure action type is in allowed list
  if (!actionType || !ALLOWED_ACTIONS[actionType]) {
    return `Invalid action type: ${actionType}. Must be one of: ${Object.keys(ALLOWED_ACTIONS).join(', ')}`;
  }

  // Ensure target ID is provided and non-empty
  if (!targetId || typeof targetId !== 'string' || targetId.trim().length === 0) {
    return 'targetId is required and must be a non-empty string';
  }

  // Ensure target type matches action
  if (!targetType || !ALLOWED_ACTIONS[actionType].includes(targetType.toLowerCase())) {
    return `Invalid target type "${targetType}" for action "${actionType}". Must be one of: ${ALLOWED_ACTIONS[actionType].join(', ')}`;
  }

  return null;
}

export default router;
