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
import { PROVENANCE_SELECT, legacyExecutedAt } from '../../services/execution/decisionProvenance.js';
import { getCurrentOutcome } from '../../services/decision-accuracy/outcomeSelection.js';

export const executionsRouter = Router();

/**
 * The OutcomeSnapshot columns this contract publishes.
 *
 * `getCurrentOutcome` REQUIRES a select — an unprojected read widens on every
 * new column — and this one deliberately omits `evidenceReference`, which is
 * storage rather than wire, and the supersession columns, which cannot be
 * anything but null on a row that seam already filtered to the current one.
 */
export const OUTCOME_SELECT = Object.freeze({
  id: true,
  measuredAt: true,
  createdAt: true,
  windowStart: true,
  windowEnd: true,
  sustained: true,
  spendDeltaMinor: true,
  revenueDeltaMinor: true,
  roasDelta: true,
});

/**
 * PURE: project the current outcome, or state that there is not one.
 *
 * NO `status` FIELD. OutcomeSnapshot has no status column, and the honest
 * answer to "what state is the outcome in" is the facts it actually carries:
 * when it was measured, over which window, and whether the lift held. Inventing
 * a status here would mean deriving a word nobody recorded.
 *
 * EVERY NULL STAYS NULL. `sustained` is a nullable Boolean where null means the
 * question was never established — a decision whose lift nobody checked is not
 * a decision whose lift failed, and `?? false` would silently convert one into
 * the other. The three deltas are the same: null is "not measured", and a 0
 * there would be a fabricated result, not an absent one.
 *
 * When there is no outcome the object carries `available: false` and NOTHING
 * else — no zeroed metrics, no null-filled skeleton that reads at a glance like
 * a recorded result.
 */
export function toOutcomeSection(o) {
  if (!o) return { available: false };
  return {
    available:  true,
    outcomeId:  o.id,
    // When the operator ESTABLISHED the result. Nullable on rows recorded
    // before R6 — an unrecorded fact stays unrecorded, never backfilled to
    // createdAt, which answers a different question.
    measuredAt: o.measuredAt ?? null,
    // When the row was written. Never a substitute for measuredAt.
    recordedAt: o.createdAt,
    window: { start: o.windowStart ?? null, end: o.windowEnd ?? null },
    // null = nobody established whether the lift held. NOT false.
    sustained: o.sustained ?? null,
    deltas: {
      spendMinor:   o.spendDeltaMinor   ?? null,
      revenueMinor: o.revenueDeltaMinor ?? null,
      roas:         o.roasDelta         ?? null,
    },
  };
}

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
      select: {
        id: true, verdict: true, status: true, dismissedAt: true, createdAt: true,
        ...PROVENANCE_SELECT,
        // The human-judgement axis, independent of both execution facts.
        humanResponse: true, humanReasonCode: true, humanRespondedAt: true,
      },
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

    // ── B4-A — the fourth axis: did anything come of it? ────────────────────
    //
    // Read through outcomeSelection.getCurrentOutcome, which owns the ONE
    // definition of "current" (`supersededAt IS NULL`, newest first). Re-deriving
    // it here as "the latest row" would be correct by accident today and wrong
    // the first time a repair script inserts out of order — and it would put a
    // second definition of the same word in the codebase.
    //
    // Workspace-scoped in its own WHERE, like the two reads above. Sequential
    // rather than parallel with them on purpose: there is nothing to look up
    // until the decision has been proven to exist in this workspace.
    const outcomeRow = await getCurrentOutcome(workspaceId, decision.id, { select: OUTCOME_SELECT });

    return res.json({
      workspaceId,
      generatedAt: new Date().toISOString(),
      decisionId: decision.id,
      verdict: decision.verdict,
      decisionStatus: decision.status,
      decisionCreatedAt: decision.createdAt,
      // ── B4-A — three independent axes, never collapsed ───────────────────
      //
      // Before the split a reader had to infer provenance: "empty executions
      // list + executedAt set ⇒ probably a self-report". That inference is gone.
      // Each fact now states itself.
      //
      // `reported: false` and `at: null` are stated rather than omitted —
      // omission reads as "not part of this response", null says "we looked and
      // it has not happened", and only the second is true here.
      humanJudgment: {
        response:    decision.humanResponse    ?? null,
        reasonCode:  decision.humanReasonCode  ?? null,
        respondedAt: decision.humanRespondedAt ?? null,
        dismissedAt: decision.dismissedAt      ?? null,
      },
      // A CLAIM by the operator that they acted themselves. Not evidence Lumi
      // executed anything, and it never creates an ExecutionRequest.
      humanExecution: {
        reported:   decision.humanExecutedAt != null,
        reportedAt: decision.humanExecutedAt ?? null,
      },
      // The ONLY evidence Lumi performed a platform mutation: written by the
      // worker after EXECUTED_SUCCESS, from the lifecycle's own instant.
      platformExecution: {
        executed:   decision.platformExecutedAt != null,
        executedAt: decision.platformExecutedAt ?? null,
      },
      // DEPRECATED — the pre-split field, derived (platform wins when both
      // exist). Kept so clients shipped before B4-A keep working; new readers
      // take the two objects above. Scheduled for removal.
      //
      // DEPRECATED COMPATIBILITY FIELD — derivation is endpoint-specific.
      //   HERE:                    platformExecutedAt ?? humanExecutedAt
      //   PATCH /decisions/:id/execute: always the human timestamp it just wrote
      // The two can therefore return DIFFERENT instants for the same decision,
      // and neither is a canonical fact. Never treat them as one: the
      // structured `humanExecution` / `platformExecution` objects above are
      // authoritative and say which happened.
      executedAt: legacyExecutedAt(decision),
      executedAtMeaning: 'DEPRECATED_DERIVED_PREFER_platformExecution',
      dismissedAt: decision.dismissedAt,

      // ── R13-D / B3-B (§6) — the honest execution summary ──────────────────
      // Platform truth, derived ONLY from the persisted ExecutionRequest
      // lifecycle. `executedAt` above is NOT an input to this and must never
      // become one: it is a DERIVED alias that collapses two different facts
      // into one field, so read alone it cannot tell you whether Lumi executed
      // the mutation or an operator said they had. The ExecutionRequest rows
      // can, which is why they are the only source here.
      //
      // NONE is a measured zero — we looked, and this decision has no
      // execution. It is not the same as QUEUED, and neither is SUCCEEDED.
      execution: summarizeExecutionState(executions),
      // Newest first, so [0] is the live attempt. Named explicitly rather than
      // left to the client to index — "which one counts" is a contract decision,
      // not a rendering one.
      current: executions[0] ?? null,
      executions,
      // A real, established zero: we looked, and this decision has none.
      count: executions.length,

      // The measured result of having acted, or an explicit absence. This is
      // the LAST axis and it is independent of the three above: an executed
      // decision may have no outcome yet, and an outcome exists only because
      // somebody recorded one — nothing in this slice matures it.
      outcome: toOutcomeSection(outcomeRow),
    });
  } catch (err) {
    logger.error({ err: err.message, workspaceId, decisionId: id }, '[lumi/executions] read failed');
    // 500, never an empty list: "no executions" is a statement about the
    // decision, and our own failure must not be able to make it.
    return res.status(500).json({ error: 'ExecutionsUnavailable', message: 'Request failed' });
  }
});
