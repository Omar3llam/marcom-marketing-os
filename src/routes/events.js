// ============================================================
// MARCOM / Lumi — Real-Time Events (SSE)
// ============================================================
// Server-Sent Events endpoint for live execution updates.
//
// SECURITY: Firebase JWTs must NEVER appear in SSE URLs because
// browser history and server access logs record query params in
// plaintext. Instead we use a two-step exchange:
//
//   Step 1 — POST /api/events/token (Authorization: Bearer <firebase-jwt>)
//     → validates the Firebase JWT via requireAuth
//     → issues a short-lived (60s), single-use UUIDv4 stream token
//     → returns { streamToken, expiresIn }
//
//   Step 2 — GET /api/events/stream?token=<uuid>
//     → validates the UUIDv4 stream token (NOT the Firebase JWT)
//     → deletes the token on first use (single-use)
//     → upgrades to SSE stream
//
// The UUID in the URL is harmless if logged: it carries no PII,
// expires in 60s, and is consumed on first connect.
// ============================================================
import { Router } from 'express';
import { requireAuth } from '../middleware/firebaseAuth.js';
import { logger }      from '../utils/logger.js';

const router = Router();

// ── Stream token store ───────────────────────────────────────
// Map<streamToken: string, { userId, workspaceId, expiresAt: ms }>
// In-memory per process — intentionally not Redis; stream tokens
// are single-use and 60s TTL so in-process is sufficient.
const STREAM_TOKEN_TTL_MS = 60_000;
const streamTokens = new Map();

// Periodic cleanup so expired tokens don't accumulate in memory.
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of streamTokens) {
    if (data.expiresAt < now) {
      streamTokens.delete(token);
    }
  }
}, 30_000);

// ── In-Memory Subscriber Registry (per workspace) ───────────
// Map<workspaceId, Set<Response>>
const workspaceStreams = new Map();

// ── POST /api/events/token ───────────────────────────────────
/**
 * Exchange a Firebase JWT (sent in Authorization header via the
 * standard api.js interceptor) for a short-lived stream token.
 * The stream token is a UUIDv4 — safe to put in a URL.
 */
router.post('/token', requireAuth, (req, res) => {
  const uid         = req.user?.uid;
  const workspaceId = req.user?.workspaceId || req.workspaceId;

  if (!uid) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (!workspaceId) {
    // User authenticated but not yet onboarded (no workspace).
    // Return 400 — client should redirect to onboarding instead.
    return res.status(400).json({
      error: 'Workspace not found',
      hint:  'Complete onboarding before connecting to the event stream',
    });
  }

  const streamToken = crypto.randomUUID();
  streamTokens.set(streamToken, {
    userId:      uid,
    workspaceId,
    expiresAt:   Date.now() + STREAM_TOKEN_TTL_MS,
  });

  logger.debug({ uid, workspaceId }, '[SSE] stream token issued');
  return res.json({ streamToken, expiresIn: STREAM_TOKEN_TTL_MS / 1000 });
});

// ── GET /api/events/stream ───────────────────────────────────
/**
 * SSE endpoint. Authenticated via short-lived stream token
 * (issued by POST /api/events/token), NOT via Firebase JWT.
 * The stream token is single-use and deleted on first connect.
 */
router.get('/stream', (req, res) => {
  const streamToken = req.query.token;

  // ── Validate stream token ─────────────────────────────────
  if (!streamToken) {
    return res.status(401).json({
      error: 'Stream token required',
      hint:  'Call POST /api/events/token first to obtain a short-lived token',
    });
  }

  const tokenData = streamTokens.get(streamToken);

  if (!tokenData) {
    return res.status(401).json({ error: 'Invalid stream token' });
  }

  if (tokenData.expiresAt < Date.now()) {
    streamTokens.delete(streamToken);
    return res.status(401).json({
      error:      'Stream token expired',
      hint:       'Tokens expire after 60s — call POST /api/events/token again',
    });
  }

  // Single-use: consume the token immediately.
  // A reconnect will require a new exchange.
  streamTokens.delete(streamToken);

  const { userId, workspaceId } = tokenData;

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
    '[SSE] client connected',
  );

  // ── Send initial connection confirmation ───────────────────
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);

  // ── Heartbeat (prevent idle timeout) ───────────────────────
  const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30_000);

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
      '[SSE] client disconnected',
    );
  });
});

// ── Broadcast Helper (used by execution.js) ──────────────────
/**
 * Broadcast an event to all subscribers in a workspace.
 */
export function broadcastWorkspaceEvent(workspaceId, event) {
  const subscribers = workspaceStreams.get(workspaceId);
  if (!subscribers || subscribers.size === 0) {
    logger.debug({ workspaceId, event }, '[SSE] no subscribers — skipping broadcast');
    return;
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
}

export default router;
