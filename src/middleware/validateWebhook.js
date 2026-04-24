// ============================================================
// MARCOM — HMAC-SHA256 Webhook Validation
// Expects headers:
//   x-webhook-signature: sha256=<hex>
//   x-webhook-timestamp: <unix seconds>
// Replay window: 5 minutes
// ============================================================
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const REPLAY_WINDOW_SECONDS = 300; // 5 minutes

export function validateWebhook(req, res, next) {
  const sigHeader = req.headers['x-webhook-signature'];
  const tsHeader  = req.headers['x-webhook-timestamp'];

  if (!sigHeader || !tsHeader) {
    logger.warn('Webhook rejected: missing signature or timestamp headers');
    return res.status(401).json({ status: 'error', message: 'Missing webhook authentication headers.' });
  }

  // ── REPLAY ATTACK PREVENTION ─────────────────────────────
  const ts = parseInt(tsHeader, 10);
  if (isNaN(ts)) {
    return res.status(401).json({ status: 'error', message: 'Invalid timestamp.' });
  }
  const now = Math.floor(Date.now() / 1_000);
  if (Math.abs(now - ts) > REPLAY_WINDOW_SECONDS) {
    logger.warn({ ts, now }, 'Webhook rejected: timestamp outside replay window');
    return res.status(401).json({ status: 'error', message: 'Request timestamp expired.' });
  }

  // ── HMAC VERIFICATION ─────────────────────────────────────
  // Signature payload: "<timestamp>.<raw body>"
  // Body must still be raw at this point — use express.raw() upstream,
  // or re-serialise from the already-parsed JSON body as fallback.
  const rawBody = req.rawBody ?? JSON.stringify(req.body) ?? '';
  const signedPayload = `${tsHeader}.${rawBody}`;

  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(signedPayload)
    .digest('hex');

  const expectedHeader = `sha256=${expected}`;

  let received;
  try {
    received = sigHeader.startsWith('sha256=') ? sigHeader : `sha256=${sigHeader}`;
  } catch {
    return res.status(401).json({ status: 'error', message: 'Malformed signature header.' });
  }

  // Constant-time comparison to prevent timing attacks
  const eBuf = Buffer.from(expectedHeader);
  const rBuf = Buffer.from(received);

  if (eBuf.length !== rBuf.length || !crypto.timingSafeEqual(eBuf, rBuf)) {
    logger.warn('Webhook rejected: HMAC mismatch');
    return res.status(401).json({ status: 'error', message: 'Invalid webhook signature.' });
  }

  next();
}

// ── RAW BODY CAPTURE MIDDLEWARE ───────────────────────────────
// Mount this BEFORE express.json() on webhook routes to preserve rawBody.
export function captureRawBody(req, res, next) {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    // Re-parse so downstream handlers still get req.body as object
    try { req.body = JSON.parse(data); } catch { req.body = {}; }
    next();
  });
}
