// Converts internal trace objects to API wire format.
// Adds human-readable narrative to each timeline entry so consumers
// can answer "what happened here?" without decoding status codes.

const TRANSITION_NARRATIVE = {
  PENDING:          'Execution created, awaiting queue',
  QUEUED:           'Queued for worker pickup',
  EXECUTING:        'Worker assigned — execution started',
  EXECUTED_SUCCESS: 'Completed successfully',
  EXECUTED_FAILED:  'Execution failed',
  TIMED_OUT:        'Timed out before completion',
  CANCELLED:        'Cancelled before execution',
};

const GRAPH_NARRATIVE = {
  'execution.started':    'Graph traversal started',
  'execution.transition': 'Graph node status changed',
  'execution.completed':  'Graph traversal completed',
  'execution.failed':     'Graph traversal failed',
};

export function serializeTrace(trace) {
  return {
    executionId:   trace.executionId,
    actionType:    trace.actionType,
    targetId:      trace.targetId,
    correlationId: trace.correlationId,
    status:        trace.status,
    createdAt:     trace.createdAt,
    updatedAt:     trace.updatedAt,
    timeline:      trace.timeline.map(_serializeEntry),
    summary:       trace.summary,
  };
}

function _serializeEntry(entry) {
  const narrative = entry.source === 'transition'
    ? (TRANSITION_NARRATIVE[entry.toStatus] ?? entry.toStatus)
    : (GRAPH_NARRATIVE[entry.eventType]     ?? entry.eventType);

  return { ...entry, narrative };
}
