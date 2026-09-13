// ============================================================
// MARCOM — HMAC-SHA256 Webhook Validation
// Expects headers:
//   x-webhook-signature: sha256=<hex>
//   x-webhook-timestamp: <unix seconds>
// Replay window: 5 minutes
// ============================================================
// SECURITY SLICE A — what the assessment established, stated precisely:
//
//   FORGERY                          blocked   (unchanged — see below)
//   REPLAY                           not blocked → closed in webhookDedup.js
//   EXHAUSTION BEFORE VERIFICATION   exposed   → closed by the cap below
//
// The verifier itself was sound and is deliberately untouched: HMAC-SHA256 over
// "<timestamp>.<raw body>", constant-time comparison, 401 on a missing or bad
// signature, a five-minute timestamp window. Nothing here weakens any of that.
//
// TWO THINGS CHANGED.
//
// 1. THE CAPTURE IS BOUNDED. captureRawBody is the first thing on /webhook/*.
//    It runs before this verifier, before express.json's 10 MB limit and before
//    the rate limiter — so with no cap of its own, an unauthenticated caller
//    could stream an unbounded body and have every byte held in memory before
//    the signature was looked at. The parser's limit cannot protect it, because
//    the parser is behind it.
//
//    The cap is in BYTES. The previous implementation accumulated a string
//    under setEncoding('utf8'), which counts CHARACTERS: a multi-byte body
//    occupies more memory than the number that would have bounded it, and the
//    re-encoded string is not the byte sequence the sender signed.
//
// 2. A VERIFIED REQUEST CARRIES ITS SIGNED IDENTITY. `webhookSignedDigest` is a
//    plain SHA-256 of the material the signature covered — not the HMAC itself,
//    which travels in a header in the clear. It is the only identity an
//    idempotency decision may rest on, because every other header is UNSIGNED
//    and can therefore be changed by an attacker without breaking verification.
//
// The re-serialise fallback is gone. `req.rawBody ?? JSON.stringify(req.body)`
// could never reproduce a sender's exact bytes, so it did not rescue a real
// request — it only masked the one mounting mistake this slice exists to
// prevent: the capture not running, or running behind the parser.
// ============================================================
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const REPLAY_WINDOW_SECONDS = 300; // 5 minutes
export const REPLAY_WINDOW_MS = REPLAY_WINDOW_SECONDS * 1_000;

// Matches express.json's limit on this same path, so a request that would have
// been accepted before is still accepted — the change is WHERE it is refused,
// not which requests are.
export const WEBHOOK_MAX_BODY_BYTES = Number(process.env.WEBHOOK_MAX_BODY_BYTES || 10 * 1024 * 1024);

export function validateWebhook(req, res, next) {
  // Ordering guard. Reaching here without captured bytes means the bounded
  // capture did not run — refuse rather than verify something else.
  if (typeof req.rawBody !== 'string') {
    logger.error({ path: req.path }, '[webhook] raw body unavailable — captureRawBody did not run ahead of validateWebhook');
    return res.status(500).json({ status: 'error', message: 'Webhook verification is misconfigured.' });
  }

  const sigHeader = req.headers['x-webhook-signature'];
  const tsHeader  = req.headers['x-webhook-timestamp'];

  if (!sigHeader || !tsHeader) {
    logger.warn('Webhook rejected: missing signature or timestamp headers');
    return res.status(401).json({ status: 'error', message: 'Missing webhook authentication headers.' });
  }

  // ── REPLAY WINDOW ─────────────────────────────────────────
  // This bounds how long a captured request stays presentable. It does not by
  // itself stop a replay inside the window — that is webhookDedup's claim.
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
  // Signature payload: "<timestamp>.<raw body>". Note what is NOT in here:
  // every other header. Nothing downstream may treat one as trusted.
  const signedPayload = `${tsHeader}.${req.rawBody}`;

  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(signedPayload)
    .digest('hex');

  const expectedHeader = `sha256=${expected}`;
  const received = sigHeader.startsWith('sha256=') ? sigHeader : `sha256=${sigHeader}`;

  // Constant-time comparison to prevent timing attacks
  const eBuf = Buffer.from(expectedHeader);
  const rBuf = Buffer.from(received);

  if (eBuf.length !== rBuf.length || !crypto.timingSafeEqual(eBuf, rBuf)) {
    logger.warn('Webhook rejected: HMAC mismatch');
    return res.status(401).json({ status: 'error', message: 'Invalid webhook signature.' });
  }

  // ── SIGNED IDENTITY ───────────────────────────────────────
  // A digest of exactly what was verified. Deterministic, so an exact replay is
  // recognisable; independent of the secret, so persisting it leaks nothing.
  req.webhookVerified = true;
  req.webhookSignedDigest = crypto.createHash('sha256').update(signedPayload).digest('hex');

  next();
}

// ── RAW BODY CAPTURE MIDDLEWARE ───────────────────────────────
// Mount this BEFORE express.json() on webhook routes to preserve rawBody.
// Buffers, never strings: the cap is a byte count and the HMAC is over bytes.
export function captureRawBody(req, res, next) {
  const chunks = [];
  let size = 0;
  let settled = false;

  const settle = (fn) => {
    if (settled) return;
    settled = true;
    fn();
  };

  req.on('data', (chunk) => {
    if (settled) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > WEBHOOK_MAX_BODY_BYTES) {
      // Refuse on the chunk that crosses the cap — not after reading to the
      // end, which would buffer the whole oversized body to measure it.
      settle(() => {
        logger.warn({ path: req.path, cap: WEBHOOK_MAX_BODY_BYTES }, '[webhook] body exceeds cap — refused before verification');
        if (typeof req.destroy === 'function') req.destroy();
        res.status(413).json({
          status: 'error',
          message: `Webhook body exceeds the ${WEBHOOK_MAX_BODY_BYTES}-byte limit.`,
        });
      });
      return;
    }
    chunks.push(buf);
  });

  req.on('end', () => settle(() => {
    const raw = Buffer.concat(chunks).toString('utf8');
    req.rawBody = raw;
    // Re-parse so downstream handlers still get req.body as object
    try { req.body = JSON.parse(raw); } catch { req.body = {}; }
    next();
  }));

  req.on('error', (err) => settle(() => {
    logger.warn({ err: err.message, path: req.path }, '[webhook] request stream error during capture');
    res.status(400).json({ status: 'error', message: 'Could not read the request body.' });
  }));
}
