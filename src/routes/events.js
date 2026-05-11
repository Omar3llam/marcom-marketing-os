// ============================================================
// MARCOM / Lumi — Real-Time Events (SSE)
// ============================================================
// Server-Sent Events endpoint for live execution updates.
// Multi-tenant isolated, authenticated via Firebase JWT.
//
// Stream lifecycle:
//   1. Client connects → /api/events/stream
//   2. Server validates auth → adds to workspaceStreams
//   3. Execution events broadcast → workspace subscribers
//   4. Client disconnects → cleanup subscriber
// ============================================================
import { Router } from 'express';
import { firebaseAuthMiddleware } from '../middleware/firebaseAuth.js';
import { contextGuard } from '../middleware/contextGuard.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ── In-Memory Subscriber Registry (per workspace) ───────────
// Map<workspaceId, Set<Response>>
const workspaceStreams = new Map();

// ── SSE Auth Middleware (query param support) ────────────────
/**
 * EventSource doesn't support custom headers, so we accept
 * the Firebase token as a query param for SSE routes only.
 * This middleware extracts ?token=... and sets it as an
 * Authorization header so firebaseAuthMiddleware can validate it.
 */
function sseAuthAdapter(req, res, next) {
  const tokenFromQuery = req.query.token;
  if (tokenFromQuery && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }
  next();
}

// ── Middleware ───────────────────────────────────────────────
router.use(sseAuthAdapter);
router.use(firebaseAuthMiddleware);
router.use(contextGuard);

// ── GET /api/events/stream ───────────────────────────────────
/**
 * SSE endpoint for real-time execution updates.
 * Client opens EventSource connection authenticated via Firebase JWT.
 * Server pushes execution lifecycle events (QUEUED, EXECUTING, SUCCESS, FAILED).
 */
router.get('/stream', (req, res) => {
  const { userId, workspaceId } = req.user;

  if (!workspaceId) {
    logger.warn({ userId }, '[SSE] missing workspaceId — rejecting stream');
    return res.status(400).json({ error: 'Workspace ID required' });
  }

  // ── SSE Headers ────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // ── Add subscriber to workspace registry ───────────────────
  if (!workspaceStreams.has(workspaceId)) {
    workspaceStreams.set(workspaceId, new Set());
  }
  workspaceStreams.get(workspaceId).add(res);

  logger.info(
    { userId, workspaceId, subscriberCount: workspaceStreams.get(workspaceId).size },
    '[SSE] client connected'
  );

  // ── Send initial connection confirmation ───────────────────
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);

  // ── Heartbeat (prevent idle timeout) ───────────────────────
  const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30_000); // 30s

  // ── Cleanup on client disconnect ───────────────────────────
  req.on('close', () => {
    clearInterval(heartbeatInterval);

    const subscribers = workspaceStreams.get(workspaceId);
    if (subscribers) {
      subscribers.delete(res);
      if (subscribers.size === 0) {
        workspaceStreams.delete(workspaceId);
      }
    }

    logger.info(
      { userId, workspaceId, remainingSubscribers: subscribers?.size || 0 },
      '[SSE] client disconnected'
    );
  });
});

// ── Broadcast Helper (used by execution.js) ──────────────────
/**
 * Broadcast an event to all subscribers in a workspace.
 * Event format:
 * {
 *   type: 'EXECUTION_STATUS',
 *   status: 'QUEUED' | 'EXECUTING' | 'EXECUTED_SUCCESS' | 'EXECUTED_FAILED',
 *   targetId: string,
 *   actionType: string,
 *   timestamp: ISO string,
 *   error?: string,        // only on FAILED
 *   auditLogId?: string,   // only on SUCCESS/FAILED
 * }
 */
export function broadcastWorkspaceEvent(workspaceId, event) {
  const subscribers = workspaceStreams.get(workspaceId);
  if (!subscribers || subscribers.size === 0) {
    logger.debug({ workspaceId, event }, '[SSE] no subscribers — skipping broadcast');
    return;
  }

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  let deadStreams = [];

  for (const res of subscribers) {
    try {
      res.write(payload);
    } catch (err) {
      logger.warn({ workspaceId, error: err.message }, '[SSE] failed to write to subscriber — marking dead');
      deadStreams.push(res);
    }
  }

  // Cleanup dead streams
  if (deadStreams.length > 0) {
    for (const deadRes of deadStreams) {
      subscribers.delete(deadRes);
    }
    logger.info(
      { workspaceId, removed: deadStreams.length, remaining: subscribers.size },
      '[SSE] cleaned up dead streams'
    );
  }

  logger.debug(
    { workspaceId, eventType: event.type, deliveredTo: subscribers.size },
    '[SSE] event broadcast'
  );
}

export default router;
