// ============================================================
// R13-D / B3-B — how an ExecutionRequest is described to a reader
// ============================================================
// One module, because the two read paths (GET /api/execute/:id and
// GET /api/lumi/decisions/:id/executions) must describe the same row the same
// way. Two hand-rolled projections would drift, and the field they would drift
// on is "did this actually happen" — the one field the product cannot afford to
// state two ways.
//
// THREE RULES HOLD EVERYTHING HERE TOGETHER.
//
// 1. NOTHING IS DERIVED FROM Decision.executedAt.
//    That column is written by two different actors for two different reasons:
//    the worker stamps it after Meta accepted a mutation, and the self-report
//    route stamps it when an operator says they did the thing by hand. Read
//    alone it cannot tell you which. Platform truth is the ExecutionRequest
//    lifecycle, and only that.
//
// 2. TIMESTAMPS ARE READ, NOT COMPUTED.
//    ExecutionRequest has exactly two time columns — createdAt and updatedAt.
//    There is no queuedAt, no startedAt, no executedAt. Those moments are real
//    and they are persisted, but they live in ExecutionTransition rows as
//    (toStatus, createdAt). So this module reads them out of the transition
//    log rather than inventing columns or, worse, presenting updatedAt as a
//    completion time. Absent transition ⇒ null. Never a guess.
//
// 3. BLOBS ARE WHITELISTED, NEVER PASSED THROUGH.
//    `ExecutionRequest.response` holds Meta's raw reply and `payload` holds the
//    original request body. Neither is published. What a reader needs from a
//    failure is a message, a code and an HTTP status; those are extracted by
//    name. A spread here would publish whatever Meta happened to return.
// ============================================================

/**
 * What a reader is told about where an execution stands.
 *
 * The six §6 distinctions are all present and none is collapsed into another.
 * TIMED_OUT and CANCELLED are kept as themselves rather than folded into
 * FAILED: a timeout is not a platform refusal, and saying "Meta rejected this"
 * about a request Meta may well have accepted is the exact class of lie this
 * slice exists to remove. Keeping them distinct preserves every required
 * distinction and adds two, which is the safe direction.
 */
export const EXECUTION_STATE = Object.freeze({
  NONE:      'NONE',       // we looked; this decision has no execution
  REQUESTED: 'REQUESTED',  // row exists, not yet queued (PENDING)
  QUEUED:    'QUEUED',     // accepted and enqueued — Meta has NOT been called
  EXECUTING: 'EXECUTING',  // worker has it; the platform call is in flight
  SUCCEEDED: 'SUCCEEDED',  // Meta accepted the mutation
  FAILED:    'FAILED',     // Meta refused it
  TIMED_OUT: 'TIMED_OUT',  // no answer — outcome genuinely unknown
  CANCELLED: 'CANCELLED',  // stopped before the platform was called
});

const STATUS_TO_STATE = Object.freeze({
  PENDING:          EXECUTION_STATE.REQUESTED,
  QUEUED:           EXECUTION_STATE.QUEUED,
  EXECUTING:        EXECUTION_STATE.EXECUTING,
  EXECUTED_SUCCESS: EXECUTION_STATE.SUCCEEDED,
  EXECUTED_FAILED:  EXECUTION_STATE.FAILED,
  TIMED_OUT:        EXECUTION_STATE.TIMED_OUT,
  CANCELLED:        EXECUTION_STATE.CANCELLED,
});

/** Terminal statuses, from the vocabulary declared on the Prisma model. */
export const TERMINAL_STATUSES = Object.freeze([
  'EXECUTED_SUCCESS', 'EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED',
]);

/** Statuses that carry failure detail worth extracting. */
const FAILURE_STATUSES = Object.freeze(['EXECUTED_FAILED', 'TIMED_OUT', 'CANCELLED']);

/**
 * PURE: status → state.
 *
 * An UNRECOGNISED status reads as EXECUTING, never as SUCCEEDED. If a future
 * status is added and this map is not updated, the failure mode is "we say it
 * is still running" — recoverable. The opposite default would announce a
 * completed ad-platform mutation on the strength of a string nobody has
 * defined yet.
 */
export function executionStateOf(status) {
  if (status == null) return EXECUTION_STATE.NONE;
  return STATUS_TO_STATE[status] ?? EXECUTION_STATE.EXECUTING;
}

export const isTerminalStatus = (status) => TERMINAL_STATUSES.includes(status);

/** Narrow an untyped Json column to a plain object, or null. */
const asObject = (v) =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;

/**
 * PURE: the moments this execution actually passed through, read out of the
 * transition log.
 *
 * EARLIEST wins for each status. A retry of the BullMQ job can re-enter
 * EXECUTING, and "when did work start" means the first time, not the last.
 *
 * `succeededAt` is deliberately not called `executedAt`. There is no executedAt
 * on this model, and the name is already spoken for by the Decision column that
 * an operator's self-report also writes. This one means exactly one thing: the
 * moment the EXECUTED_SUCCESS transition was recorded, which is the moment
 * after Meta accepted the mutation. That is platform truth; the Decision column
 * is not.
 */
export function lifecycleTimestamps(transitions = []) {
  const earliest = (status) => {
    let found = null;
    for (const t of transitions) {
      if (t?.toStatus !== status) continue;
      const at = t.createdAt ?? null;
      if (at == null) continue;
      if (found === null || new Date(at) < new Date(found)) found = at;
    }
    return found;
  };

  return {
    queuedAt:    earliest('QUEUED'),
    startedAt:   earliest('EXECUTING'),
    succeededAt: earliest('EXECUTED_SUCCESS'),
    // Whichever way it ended badly. Kept as one field because a row reaches at
    // most one of these; `status` already says which.
    failedAt:    earliest('EXECUTED_FAILED') ?? earliest('TIMED_OUT') ?? earliest('CANCELLED'),
  };
}

/**
 * PURE: what went wrong, by name, from two persisted sources.
 *
 * `response` on a failed row is written by the worker as { error, code } — the
 * message Meta returned and its error code. `platformStatus` and `reason` are
 * on the terminal transition's metadata. Both are read field by field.
 *
 * Returns null for anything not in a failure state: a QUEUED row has no
 * failure, and manufacturing an empty one would make "no error yet" and "an
 * error with no detail" indistinguishable.
 */
export function failureFrom({ status, response, transitions = [] } = {}) {
  if (!FAILURE_STATUSES.includes(status)) return null;

  const r = asObject(response);
  // Last matching transition: if a row somehow re-entered a failure state, the
  // most recent one is the one that stuck.
  const terminal = [...transitions].reverse().find((t) => FAILURE_STATUSES.includes(t?.toStatus));
  const meta = asObject(terminal?.metadata);

  const code = r?.code;
  return {
    message:        typeof r?.error === 'string' ? r.error : null,
    code:           (typeof code === 'string' || typeof code === 'number') ? code : null,
    platformStatus: Number.isFinite(meta?.platformStatus) ? meta.platformStatus : null,
    // 'non_retriable' | 'max_retries_exceeded' | 'timeout_exceeded' | …
    reason:         typeof meta?.reason === 'string' ? meta.reason : null,
  };
}

/**
 * PURE: retry lineage off the untyped retryMetadata blob.
 *
 * Lifted out by name because `retryOf` is the part the product needs — which
 * execution this one replaces — and a client reading an untyped column would
 * be guessing at a shape. An original carries no lineage: retryOf null, depth 0.
 */
export function retryLineage(retryMetadata) {
  const meta = asObject(retryMetadata);
  return {
    retryOf:    meta?.retryOf ?? null,
    retryDepth: Number.isFinite(meta?.retryDepth) ? meta.retryDepth : 0,
  };
}

/**
 * PURE: the full description of ONE execution.
 *
 * @param {object}   args.execution   ExecutionRequest row (see EXECUTION_DETAIL_SELECT)
 * @param {object[]} args.transitions its ExecutionTransition rows, ascending
 * @param {object|null} args.decision the attributed Decision, already workspace-scoped
 */
export function toExecutionDetail({ execution, transitions = [], decision = null } = {}) {
  const times = lifecycleTimestamps(transitions);

  return {
    executionId: execution.id,
    // §5 — the link, by id, or null. Never a name, never "Unknown".
    decisionId:  execution.decisionId ?? null,

    status:   execution.status,
    state:    executionStateOf(execution.status),
    terminal: isTerminalStatus(execution.status),

    actionType: execution.actionType,
    targetId:   execution.targetId,

    requestedAt: execution.createdAt,
    ...times,
    // The last state change, NOT a completion time. Named for what it is.
    lastTransitionAt: execution.updatedAt,

    ...retryLineage(execution.retryMetadata),
    correlationId: execution.correlationId ?? null,
    version:       execution.version ?? null,

    // Whether a platform reply was persisted — WITHOUT publishing it. The blob
    // is Meta's raw response; the existing contract does not permit shipping it
    // to a client and this slice does not widen that. A reader learns that it
    // exists and can be pulled by an operator with database access.
    hasResponse: execution.response != null,
    failure:     failureFrom({ status: execution.status, response: execution.response, transitions }),

    // §3 "workspace-safe entity identity" — ids and enums only, resolved
    // through the Decision. No campaign name, no Meta name: a name is not an
    // identity and joining on one is how two records silently become one.
    decision: decision
      ? {
        decisionId:  decision.id,
        entityId:    decision.entityId,
        entityLevel: decision.entityLevel,
        verdict:     decision.verdict,
        status:      decision.status,
        // Published, and labelled. This is the OPERATOR/self-report axis: the
        // worker writes it after a real mutation, and the self-report route
        // writes the same column when a human says they acted by hand. It is
        // NOT proof of a Meta mutation — `state` above is.
        selfReportedOrExecutedAt: decision.executedAt,
        dismissedAt:              decision.dismissedAt,
      }
      : null,
  };
}

/**
 * PURE: one honest sentence about a Decision's execution history.
 *
 * `rows` are that decision's executions, NEWEST FIRST (the order both read
 * paths use). The newest is the live attempt and gives the state; the count is
 * the whole history and is not collapsed, because "one attempt, twice retried"
 * and "three executions" are different facts about an ad account.
 */
export function summarizeExecutionState(rows = []) {
  const current = rows[0] ?? null;
  return {
    state:      executionStateOf(current?.status ?? null),
    count:      rows.length,
    // True only from the persisted lifecycle. Never from Decision.executedAt.
    succeeded:  current?.status === 'EXECUTED_SUCCESS',
    terminal:   current ? isTerminalStatus(current.status) : false,
  };
}

/** Columns the detail read needs. Named, so `payload` is never pulled. */
export const EXECUTION_DETAIL_SELECT = Object.freeze({
  id: true,
  decisionId: true,
  status: true,
  actionType: true,
  targetId: true,
  createdAt: true,
  updatedAt: true,
  correlationId: true,
  retryMetadata: true,
  version: true,
  // Selected to answer hasResponse and to extract failure detail by name.
  // NEVER spread into the wire payload.
  response: true,
});
