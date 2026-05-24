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
  EXECUTION_PAUSED:  'EXECUTION_PAUSED',   // PR #29: pause for approval
  EXECUTION_RESUMED: 'EXECUTION_RESUMED',  // PR #29: resume after approval

  NODE_START:   'NODE_START',
  NODE_SUCCESS: 'NODE_SUCCESS',
  NODE_FAILURE: 'NODE_FAILURE',
  NODE_RETRY:   'NODE_RETRY',
  NODE_SKIPPED: 'NODE_SKIPPED',

  CHECKPOINT_CREATED: 'CHECKPOINT_CREATED', // PR #29: checkpoint saved
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED', // PR #29: approval needed
  APPROVAL_RECEIVED:  'APPROVAL_RECEIVED',  // PR #29: approval granted
});

export const EXECUTION_STATUS = Object.freeze({
  SUCCESS:            'SUCCESS',
  PARTIAL_SUCCESS:    'PARTIAL_SUCCESS',
  FAILURE:            'FAILURE',
  PAUSED_FOR_APPROVAL: 'PAUSED_FOR_APPROVAL', // PR #29: execution paused
});

export const NODE_STATUS = Object.freeze({
  PENDING:  'PENDING',
  RUNNING:  'RUNNING',
  SUCCESS:  'SUCCESS',
  FAILURE:  'FAILURE',
  SKIPPED:  'SKIPPED',
});
