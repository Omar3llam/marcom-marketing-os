// ============================================================
// Runtime Events — execution lifecycle event types
// ============================================================
// Frozen enums for all execution runtime events.
// Events are emitted during graph execution for observability.
//
// Event ordering is deterministic — same graph produces
// same event sequence in the same order.
// ============================================================

export const RUNTIME_EVENT = Object.freeze({
  EXECUTION_START:   'EXECUTION_START',
  EXECUTION_SUCCESS: 'EXECUTION_SUCCESS',
  EXECUTION_FAILURE: 'EXECUTION_FAILURE',

  NODE_START:   'NODE_START',
  NODE_SUCCESS: 'NODE_SUCCESS',
  NODE_FAILURE: 'NODE_FAILURE',
  NODE_RETRY:   'NODE_RETRY',
  NODE_SKIPPED: 'NODE_SKIPPED',
});

export const EXECUTION_STATUS = Object.freeze({
  SUCCESS:         'SUCCESS',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  FAILURE:         'FAILURE',
});

export const NODE_STATUS = Object.freeze({
  PENDING:  'PENDING',
  RUNNING:  'RUNNING',
  SUCCESS:  'SUCCESS',
  FAILURE:  'FAILURE',
  SKIPPED:  'SKIPPED',
});
