// ============================================================
// SLICE C — the declared authorization policy of the /api/execute mount
// ------------------------------------------------------------
// Omar's constraint on RED: "Do not start by asserting that all 13 routes must
// become STRATEGIST/BUYER. First pin the policy … then enumerate the intended
// visibility for the 13 routes from the existing product authorization model."
//
// So this table is DERIVED, never chosen. Every row carries the evidence that
// decided it, and the evidence is ranked — a route classified only by the
// family rule is marked as such, because that is weaker than a route whose own
// consumer names its audience.
//
// THE EVIDENCE CLASSES
//
//   A  STATED IN-REPO, ON THIS MOUNT. routes/execution/detail.js:42-44, the
//      comment above the one read that IS gated:
//        'The roles that may queue a mutation are the roles that may read the
//         mutation log. A CLIENT seat cannot execute and has no business
//         reading what was executed.'
//      That is the product's own rule for this family. It was written for
//      GET /:id and applied to GET /:id alone.
//
//   B  THE ROLE MODEL. services/collaboration/roleScope.js —
//        CLIENT is 'read-only narrative (leadership); sees the REPORT only'
//        VISIBLE_STATES.CLIENT = ['REPORT'];  canExecute(CLIENT) === false
//
//   C  SIBLING PRECEDENT ON THE SAME MOUNT. GET /artifacts/approved is gated
//      requireCollabRole(BUYER, STRATEGIST) — so the product has already ruled
//      that reading execution artifacts is an operator capability.
//
//   D  THE CONSUMER NAMES THE AUDIENCE. The client calls it from an operations
//      surface (pages/demo/Operations/*) or an operator hook. Measured across
//      657 client sources; the call site is recorded per row.
//
//   E  NO CONSUMER AT ALL. No client call site exists. This is the WEAKEST
//      class: it cannot say who the audience is, only that no surface asks.
//      Such a row falls back to the family rule (A) and is flagged, so a reader
//      can see which rows rest on inference rather than on a named consumer.
//
// ⚠️ WHAT THE SEARCH FOUND, AND WHAT IT DID NOT
// Every consumer of an execution-operational read sits in an operations
// surface. **Zero routes produced evidence of a legitimate CLIENT audience** —
// not in the role model, not in a client surface, not in a comment. That is a
// measurement, not a permission to skip the mechanism: closure condition 3
// requires a deliberate CLIENT exception to be explicit and tested, so the
// exception list EXISTS below and is currently EMPTY. An empty exception list
// and an absent exception mechanism are different things.
// ============================================================

/** Audiences a route may declare. */
export const AUDIENCE = Object.freeze({
  /** BUYER + STRATEGIST. The operator tier. */
  OPERATORS: 'OPERATORS',
  /** STRATEGIST alone. Nothing on this mount is classified here today. */
  STRATEGIST_ONLY: 'STRATEGIST_ONLY',
  /** Deliberately readable by every seat in the workspace, CLIENT included. */
  WORKSPACE_ANY: 'WORKSPACE_ANY',
});

/**
 * Every route registered under /api/execute, with the audience the product's
 * own authorization model gives it and the evidence that decided it.
 *
 * `enforcedToday` records what the SHIPPED code does, so the gap is a fact in
 * the table rather than an inference drawn from a failing test.
 */
export const EXECUTE_MOUNT_POLICY = Object.freeze([
  // ── Already explicit: the money boundary (Slice B) and resume ────────────
  { method: 'POST', path: '/meta',      file: 'meta.js',   audience: AUDIENCE.OPERATORS, enforcedToday: 'requireFreshAuthority(BUYER, STRATEGIST)', evidence: ['A', 'B'], basisNote: 'canonical mutation path — Slice B' },
  { method: 'POST', path: '/:id/retry', file: 'retry.js',  audience: AUDIENCE.OPERATORS, enforcedToday: 'requireFreshAuthority(BUYER, STRATEGIST)', evidence: ['A', 'B'], basisNote: 'canonical mutation path — Slice B' },
  { method: 'POST', path: '/:id/resume', file: 'resume.js', audience: AUDIENCE.OPERATORS, enforcedToday: 'requireCollabRole(BUYER, STRATEGIST)',    evidence: ['A', 'B'], basisNote: 'applies approval decisions and re-executes nodes' },

  // ── Already explicit reads ───────────────────────────────────────────────
  { method: 'GET', path: '/:id',                file: 'detail.js',    audience: AUDIENCE.OPERATORS, enforcedToday: 'requireCollabRole(BUYER, STRATEGIST)', evidence: ['A'], basisNote: 'the route the family rule was written above' },
  { method: 'GET', path: '/artifacts/approved', file: 'artifacts.js', audience: AUDIENCE.OPERATORS, enforcedToday: 'requireCollabRole(BUYER, STRATEGIST)', evidence: ['C'], basisNote: 'the sibling precedent itself' },

  // ── THE THIRTEEN. Authenticated only today ───────────────────────────────
  { method: 'GET', path: '/audit',           file: 'audit.js',      audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['A', 'E'], basisNote: 'IS the mutation log the family rule names, verbatim; no client caller' },
  { method: 'GET', path: '/vitals',          file: 'vitals.js',     audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['D', 'A'], basisNote: 'pages/demo/Operations/components/RuntimeHealthStrip.jsx' },
  { method: 'GET', path: '/active',          file: 'active.js',     audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['D', 'A'], basisNote: 'pages/demo/Operations/LiveMonitor.jsx' },
  { method: 'GET', path: '/paused',          file: 'checkpoint.js', audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['A', 'E'], basisNote: 'paused-execution roster; no client caller' },
  { method: 'GET', path: '/metrics/summary', file: 'metrics.js',    audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['D', 'A'], basisNote: 'pages/demo/Operations/components/RuntimeHealthStrip.jsx' },
  { method: 'GET', path: '/:id/trace',       file: 'trace.js',      audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['A', 'E'], basisNote: 'per-execution trace timeline; no client caller' },
  { method: 'GET', path: '/:id/transitions', file: 'transitions.js', audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['D', 'A'], basisNote: 'pages/demo/Operations/ExecutionTimeline.jsx' },
  { method: 'GET', path: '/:id/incident',    file: 'incident.js',   audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['D', 'A'], basisNote: 'pages/demo/Operations/IncidentPanel.jsx' },
  { method: 'GET', path: '/:id/checkpoint',  file: 'checkpoint.js', audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['A', 'E'], basisNote: 'latest checkpoint for one execution; no client caller' },
  { method: 'GET', path: '/:id/active',      file: 'reconciliation.js', audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['D', 'A'], basisNote: 'hooks/useExecutionReconciliation/index.js' },
  { method: 'GET', path: '/:executionId/artifacts', file: 'artifacts.js', audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['C', 'E'], basisNote: 'artifact listing; the gated sibling is one segment away' },
  { method: 'GET', path: '/:executionId/artifacts/pending-approval', file: 'artifacts.js', audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['D', 'C'], basisNote: 'hooks/useArtifactApproval.js — an approval surface' },
  { method: 'GET', path: '/artifacts/:id', file: 'artifacts.js', audience: AUDIENCE.OPERATORS, enforcedToday: null, evidence: ['C', 'E'], sample: '/artifacts/art-1', basisNote: 'single artifact read; sibling precedent. NOTE the path is :id, not :artifactId — the wiring census rejected the latter, which is the census doing its job' },
]);

/**
 * Routes deliberately readable by a CLIENT seat.
 *
 * EMPTY, and that emptiness is a measured result: the classification above
 * found no route carrying evidence of a CLIENT audience. The list exists so
 * that adding one is a decision somebody writes down, rather than a gate
 * somebody forgets.
 */
export const CLIENT_READABLE = Object.freeze([]);

/** Routes whose authorization is currently left to the mount — i.e. absent. */
export const UNGATED_TODAY = Object.freeze(
  EXECUTE_MOUNT_POLICY.filter((r) => r.enforcedToday === null),
);

/** A concrete, requestable path for a policy row, with params filled in. */
export function requestPath(row) {
  // A row may carry its own sample when the generic substitution would produce
  // a misleading path — GET /artifacts/:id takes an ARTIFACT id, and filling it
  // with an execution id would make a passing test say the wrong thing.
  const path = row.sample ?? row.path
    .replace(':executionId', 'exec-1')
    .replace(':id', 'exec-1');
  return '/api/execute' + path;
}

/** A label a test name can carry without colliding between two rows. */
export function label(row) {
  return row.method + ' ' + row.path;
}
