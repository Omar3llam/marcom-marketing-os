// ============================================================
// GET /api/lumi/decisions/:id/executions — what happened after Execute
// ============================================================
// R13-D / B3. The read path the B3 discovery found missing:
// `ExecutionRequest.decisionId` carried an FK and a dedicated index and was
// projected by zero routes, so a mutation Lumi performed could never be read
// back against the call that prompted it.
//
// ONE-TO-MANY, DELIBERATELY. A Decision may own several ExecutionRequests —
// `retry` mints a fresh row rather than mutating the original, and one verdict
// can be acted on more than once. This returns the list AND names the current
// one; it does not collapse them, because a collapse would make a retry
// indistinguishable from a second attempt at the same thing, and the lineage
// that tells them apart is already on the row.
//
// NOTHING IS DERIVED HERE. `status` is the row's, `requestedAt` is its
// createdAt, `lastTransitionAt` is its updatedAt. There is no `executedAt`
// column on ExecutionRequest and none is invented: the success-derived
// timestamp lives on the Decision, is written only by the worker after Meta
// accepted the mutation, and is returned once at the envelope level where it
// belongs.
//
// `provider` is likewise absent rather than fabricated. The model has no such
// column; what it has is `actionType` and `targetId`, which say the same thing
// with more precision and are real row values.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { requireCollabRole } from '../../middleware/requireCollabRole.js';
import { WORKSPACE_ROLE } from '../../services/collaboration/roleScope.js';
import { logger } from '../../utils/logger.js';
import {
  TERMINAL_STATUSES as PROJECTION_TERMINAL_STATUSES,
  executionStateOf,
  retryLineage,
  summarizeExecutionState,
} from '../../services/execution/executionProjection.js';

export const executionsRouter = Router();

// Gated to the operating roles, matching the producer it reports on: a CLIENT
// cannot queue a mutation (routes/execution/meta.js) and has no business
// reading the mutation log either.
const OPERATORS = [WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST];

// Terminal states, from the ExecutionRequest.status vocabulary on the model.
// R13-D / B3-B: re-exported from executionProjection rather than declared twice.
// This route and GET /api/execute/:id describe the same rows, and "is this
// finished" drifting between them is precisely how one surface starts calling
// an execution done while the other still shows it running.
export const TERMINAL_STATUSES = PROJECTION_TERMINAL_STATUSES;

/**
 * The columns this contract publishes. Named rather than a select-less read,
 * which would pull `payload` and `response` — the full request body and the
 * whole Meta reply — on every row, to discard almost all of it.
 */
export const EXECUTION_SELECT = Object.freeze({
  id: true,
  decisionId: true,
  status: true,
  actionType: true,
  targetId: true,
  createdAt: true,
  updatedAt: true,
  correlationId: true,
  retryMetadata: true,
});

/**
 * PURE: project one ExecutionRequest row for the wire.
 *
 * `retryOf` is lifted out of `retryMetadata` because it is the one part of that
 * blob the product needs — which execution this one replaces — and a client
 * reading an untyped JSON column for it would be guessing at a shape. The rest
 * of the blob is not published; it is operational detail.
 */
export function toExecutionRow(e) {
  return {
    executionId: e.id,
    decisionId:  e.decisionId ?? null,
    status:      e.status,
    // R13-D / B3-B — the same vocabulary GET /api/execute/:id reports, so the
    // two paths cannot describe one row two ways.
    state:       executionStateOf(e.status),
    terminal:    TERMINAL_STATUSES.includes(e.status),
    // A mutation names an action and a target. Both are row values; neither is
    // a label we chose at read time.
    actionType:  e.actionType,
    targetId:    e.targetId,
    requestedAt: e.createdAt,
    // The last state change, NOT a completion time. At a terminal status the
    // two coincide; before one, this is simply when the row last moved, and
    // calling it `executedAt` would assert a completion that has not happened.
    lastTransitionAt: e.updatedAt,
    // Lineage: null on an original, the parent's id on a retry. This is what
    // makes "three rows" readable as "one attempt, twice retried" instead of
    // three separate executions.
    ...retryLineage(e.retryMetadata),
    // Shared across a whole retry chain (the route seeds it from the original
    // idempotency key), so a client can group without walking the lineage.
    correlationId: e.correlationId ?? null,
  };
}

/**
 * Executions carried out for ONE decision.
 *
 * Returns 404 for a decision in another workspace — the same shape as one that
 * does not exist, so the response cannot be used to discover which ids are real.
 */
executionsRouter.get('/decisions/:id/executions', requireCollabRole(...OPERATORS), async (req, res) => {
  const { id } = req.params;
  const workspaceId = req.workspaceId;
  if (!workspaceId) return res.status(400).json({ error: 'NoWorkspace', message: 'No workspace resolved' });

  try {
    // The decision is resolved FIRST, inside the workspace. The executions read
    // below is scoped by workspace as well — two predicates, because the FK on
    // `decisionId` targets `decisions.id` alone and carries no tenant
    // component, so the database would not catch a cross-workspace row on its
    // own. Neither guard is redundant; they answer different questions.
    const decision = await prisma.decision.findFirst({
      where:  { id, workspaceId },
      // executedAt is the success-derived fact — written by the worker only
      // after Meta accepted the mutation (stampDecisionExecuted). It is the
      // Decision's, not the execution's, and is published once here rather
      // than copied onto every row.
      select: { id: true, verdict: true, status: true, executedAt: true, dismissedAt: true },
    });
    if (!decision) {
      return res.status(404).json({ error: 'DecisionNotFound', message: 'No such decision in this workspace' });
    }

    const rows = await prisma.executionRequest.findMany({
      where:   { decisionId: id, workspaceId },
      select:  EXECUTION_SELECT,
      orderBy: { createdAt: 'desc' },
      // Bounded by MAX_RETRY_DEPTH in practice; a cap here would silently hide
      // the tail of a chain and make `current` a claim about a truncated set.
      take: 50,
    });

    const executions = rows.map(toExecutionRow);

    return res.json({
      workspaceId,
      generatedAt: new Date().toISOString(),
      decisionId: decision.id,
      verdict: decision.verdict,
      decisionStatus: decision.status,
      // The two human/lifecycle timestamps, so a reader can tell "Lumi executed
      // this" from "the operator said they executed it themselves" — the
      // self-report route writes the same column, and the execution list beside
      // it is what distinguishes them. Empty list + executedAt set ⇒ self-report.
      executedAt: decision.executedAt,
      dismissedAt: decision.dismissedAt,

      // ── R13-D / B3-B (§6) — the honest execution summary ──────────────────
      // Platform truth, derived ONLY from the persisted ExecutionRequest
      // lifecycle. `executedAt` above is NOT an input to this and must never
      // become one: the worker writes that column after a real mutation and the
      // self-report route writes the same column when a human says they acted
      // by hand, so read alone it cannot tell you which happened.
      //
      // NONE is a measured zero — we looked, and this decision has no
      // execution. It is not the same as QUEUED, and neither is SUCCEEDED.
      execution: summarizeExecutionState(executions),
      // Named so no reader has to infer what the column means from its name.
      executedAtMeaning: 'OPERATOR_SELF_REPORT_OR_WORKER_STAMP',
      // Newest first, so [0] is the live attempt. Named explicitly rather than
      // left to the client to index — "which one counts" is a contract decision,
      // not a rendering one.
      current: executions[0] ?? null,
      executions,
      // A real, established zero: we looked, and this decision has none.
      count: executions.length,
    });
  } catch (err) {
    logger.error({ err: err.message, workspaceId, decisionId: id }, '[lumi/executions] read failed');
    // 500, never an empty list: "no executions" is a statement about the
    // decision, and our own failure must not be able to make it.
    return res.status(500).json({ error: 'ExecutionsUnavailable', message: 'Request failed' });
  }
});
