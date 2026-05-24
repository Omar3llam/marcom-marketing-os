// Approved event types for the execution graph layer.
// Authoritative reference: docs/runtime-events.md
export const GraphEventType = Object.freeze({
  STARTED:    'execution.started',
  TRANSITION: 'execution.transition',
  COMPLETED:  'execution.completed',
  FAILED:     'execution.failed',
});

function generateEventId() {
  const ts   = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 9);
  return `evt_${ts}_${rand}`;
}

// Create a structured graph event with required identity fields + caller-supplied payload.
// Correlation fields (executionId, workerId, graphNodeId, attempt) must be supplied
// by the caller when known — they default to null so traces can detect missing context.
export function createGraphEvent(eventType, payload = {}) {
  return {
    eventType,
    eventId:     generateEventId(),
    timestamp:   new Date().toISOString(),
    executionId: null,
    workerId:    null,
    graphNodeId: null,
    attempt:     1,
    ...payload,
  };
}

// Deliver event to the optional emitter. Safe no-op when emitter is null/undefined.
export function emitGraphEvent(event, emitter) {
  if (typeof emitter === 'function') emitter(event);
}
