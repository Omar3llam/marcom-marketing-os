// ============================================================
// Execution Lifecycle Telemetry
// Phase 11B Task 3: Structured event emission
//
// Governance Constraint D: Centralized Timeout Governance
// "Every transition, retry, SSE event, worker execution,
// reconciliation call must carry the same correlation lineage."
//
// Architectural Law 4: Transition Events First-Class Citizens
// "Every transition must produce structured event internally
// even before Task 7 audit table."
// ============================================================

import { logger } from '../../utils/logger.js';
import { isTerminalState } from '../../types/execution.js';

/**
 * Create Transition Event
 *
 * Produces structured event for every state transition.
 * This is the canonical event format for:
 * - Telemetry (OpenTelemetry spans in Phase 12+)
 * - Audit logging (Task 7)
 * - SSE broadcast (Task 6)
 * - Correlation tracing (Governance Constraint C)
 *
 * @param {object} params - Event parameters
 * @param {string} params.executionId - Execution request ID
 * @param {string} params.fromStatus - Previous status
 * @param {string} params.toStatus - New status
 * @param {number} params.fromVersion - Version before transition
 * @param {number} params.toVersion - Version after transition
 * @param {string} params.correlationId - Correlation lineage ID
 * @param {string} params.actor - Who initiated transition (TransitionActor)
 * @param {object} params.metadata - Additional context
 * @returns {object} Structured transition event
 */
export function createTransitionEvent({
  executionId,
  fromStatus,
  toStatus,
  fromVersion,
  toVersion,
  correlationId,
  actor,
  metadata = {},
}) {
  const event = {
    // Event identity
    eventType: 'execution.transition',
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),

    // Execution identity
    executionId,
    correlationId,

    // Transition details
    transition: {
      from: fromStatus,
      to: toStatus,
    },

    // Version tracking (OCC)
    version: {
      from: fromVersion,
      to: toVersion,
    },

    // Actor (who initiated)
    actor,

    // Metadata (retry info, error details, etc.)
    metadata,

    // Terminal flag (for cleanup/monitoring)
    isTerminal: isTerminalState(toStatus),
  };

  return event;
}

/**
 * Emit Transition Event
 *
 * Logs structured event + sends to telemetry sinks.
 * In Phase 12+, this will:
 * - Send OpenTelemetry spans
 * - Publish to event bus (if CQRS added)
 * - Update monitoring dashboards
 *
 * @param {object} event - Structured transition event from createTransitionEvent()
 */
export function emitTransitionEvent(event) {
  const { executionId, transition, correlationId, actor, isTerminal } = event;

  // Log at appropriate level based on outcome
  const logLevel = isTerminal ? 'info' : 'debug';

  logger[logLevel]({
    ...event,
    // Flatten for easier querying
    executionId,
    correlationId,
    fromStatus: transition.from,
    toStatus: transition.to,
    actor,
    isTerminal,
  }, `Execution transition: ${transition.from} → ${transition.to}`);

  // Future: Send to OpenTelemetry, event bus, metrics sink, etc.
  // For now, structured logging is sufficient.
}

/**
 * Create Concurrency Violation Event
 *
 * Special event type for OCC conflicts.
 * Helps diagnose race conditions in distributed environment.
 *
 * @param {object} params - Event parameters
 * @param {string} params.executionId - Execution request ID
 * @param {number} params.expectedVersion - Version caller expected
 * @param {number} params.actualVersion - Actual current version
 * @param {string} params.correlationId - Correlation lineage ID
 * @param {string} params.actor - Who attempted transition
 * @returns {object} Structured concurrency violation event
 */
export function createConcurrencyViolationEvent({
  executionId,
  expectedVersion,
  actualVersion,
  correlationId,
  actor,
}) {
  const event = {
    eventType: 'execution.concurrency_violation',
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),

    executionId,
    correlationId,
    actor,

    version: {
      expected: expectedVersion,
      actual: actualVersion,
      drift: actualVersion - expectedVersion,
    },
  };

  return event;
}

/**
 * Emit Concurrency Violation Event
 *
 * Logs OCC conflict for diagnostics.
 * High volume of these events indicates:
 * - Excessive worker concurrency
 * - Missing retry backoff
 * - Race conditions in orchestration
 *
 * @param {object} event - Concurrency violation event
 */
export function emitConcurrencyViolationEvent(event) {
  const { executionId, correlationId, version, actor } = event;

  logger.warn({
    ...event,
    executionId,
    correlationId,
    expectedVersion: version.expected,
    actualVersion: version.actual,
    versionDrift: version.drift,
    actor,
  }, 'OCC concurrency violation detected');

  // Future: Increment Prometheus counter for concurrency violations
}

/**
 * Create Timeout Event
 *
 * Special event type for automatic timeout transitions.
 * Helps identify execution bottlenecks + zombie states.
 *
 * @param {object} params - Event parameters
 * @param {string} params.executionId - Execution request ID
 * @param {string} params.fromStatus - Status that timed out
 * @param {number} params.elapsed - Time elapsed in ms
 * @param {number} params.timeout - Timeout threshold in ms
 * @param {string} params.correlationId - Correlation lineage ID
 * @returns {object} Structured timeout event
 */
export function createTimeoutEvent({
  executionId,
  fromStatus,
  elapsed,
  timeout,
  correlationId,
}) {
  const event = {
    eventType: 'execution.timeout',
    eventId: generateEventId(),
    timestamp: new Date().toISOString(),

    executionId,
    correlationId,

    timeout: {
      status: fromStatus,
      elapsed,
      threshold: timeout,
      overage: elapsed - timeout,
    },
  };

  return event;
}

/**
 * Emit Timeout Event
 *
 * Logs automatic timeout for monitoring.
 * Frequent timeouts indicate:
 * - Worker starvation
 * - Meta API slowness
 * - Queue backlog
 *
 * @param {object} event - Timeout event
 */
export function emitTimeoutEvent(event) {
  const { executionId, correlationId, timeout } = event;

  logger.warn({
    ...event,
    executionId,
    correlationId,
    status: timeout.status,
    elapsed: timeout.elapsed,
    threshold: timeout.threshold,
    overage: timeout.overage,
  }, 'Execution timed out');

  // Future: Increment Prometheus counter for timeouts by status
}

/**
 * Generate Event ID
 *
 * Creates unique ID for event deduplication + tracing.
 * Format: evt_<timestamp>_<random>
 *
 * @returns {string} Unique event ID
 */
function generateEventId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `evt_${timestamp}_${random}`;
}
