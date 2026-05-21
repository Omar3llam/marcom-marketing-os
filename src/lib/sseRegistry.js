// ============================================================
// MARCOM / Lumi — SSE Subscriber Registry
// ============================================================
// In-process registry of active SSE subscribers, keyed by workspace.
// Lives in /lib (not /routes) so any service can broadcast without
// dragging the HTTP/Firebase import chain into pure-logic modules.
//
// The HTTP layer (routes/events.js) is responsible for adding/removing
// Response objects via addSubscriber / removeSubscriber. The lifecycle
// service is responsible for emitting events via broadcastWorkspaceEvent.
// ============================================================
import { logger } from '../utils/logger.js';

/** Map<workspaceId, Set<Response>> */
const workspaceStreams = new Map();

/**
 * Register an SSE Response object under a workspace.
 * Called by GET /api/events/stream after authenticating the subscriber.
 */
export function addSubscriber(workspaceId, res) {
  if (!workspaceStreams.has(workspaceId)) {
    workspaceStreams.set(workspaceId, new Set());
  }
  workspaceStreams.get(workspaceId).add(res);
  return workspaceStreams.get(workspaceId).size;
}

/**
 * Remove an SSE Response. Called from the request's `close` handler.
 * Cleans up the workspace entry once the last subscriber departs.
 */
export function removeSubscriber(workspaceId, res) {
  const subscribers = workspaceStreams.get(workspaceId);
  if (!subscribers) return 0;
  subscribers.delete(res);
  if (subscribers.size === 0) {
    workspaceStreams.delete(workspaceId);
    return 0;
  }
  return subscribers.size;
}

/**
 * Broadcast an event to all subscribers in a workspace.
 * Best-effort: writes that throw mark the stream dead and prune it.
 *
 * Returns the number of subscribers the event reached (0 when nobody
 * is listening — used by callers that want to short-circuit).
 */
export function broadcastWorkspaceEvent(workspaceId, event) {
  const subscribers = workspaceStreams.get(workspaceId);
  if (!subscribers || subscribers.size === 0) {
    logger.debug({ workspaceId, event }, '[SSE] no subscribers — skipping broadcast');
    return 0;
  }

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const deadStreams = [];

  for (const res of subscribers) {
    try {
      res.write(payload);
    } catch (err) {
      logger.warn({ workspaceId, error: err.message }, '[SSE] failed to write — marking dead');
      deadStreams.push(res);
    }
  }

  if (deadStreams.length > 0) {
    for (const dead of deadStreams) subscribers.delete(dead);
    logger.info(
      { workspaceId, removed: deadStreams.length, remaining: subscribers.size },
      '[SSE] cleaned up dead streams',
    );
  }

  logger.debug(
    { workspaceId, eventType: event.type, deliveredTo: subscribers.size },
    '[SSE] event broadcast',
  );

  return subscribers.size;
}

/**
 * Test-only: drain all subscribers. Not exported in production paths;
 * callers should use removeSubscriber per-connection.
 */
export function _resetForTests() {
  workspaceStreams.clear();
}
