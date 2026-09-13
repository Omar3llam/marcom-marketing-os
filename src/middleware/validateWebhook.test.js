// ============================================================
// validateWebhook — what the signature does and does not get right
// ------------------------------------------------------------
// The assessment that produced this slice found three separate answers, and
// the precision matters:
//
//   FORGERY                          blocked
//   REPLAY                           not blocked
//   EXHAUSTION BEFORE VERIFICATION   exposed
//
// The verifier itself is sound: HMAC-SHA256 over "<timestamp>.<raw body>",
// constant-time comparison, 401 on a missing or invalid signature, a five-minute
// timestamp window. Those properties are asserted here so the slice cannot
// weaken them while closing the other two.
//
// What this slice ADDS to the verifier is the signed identity: the only material
// an idempotency decision is allowed to rest on. Headers other than the
// timestamp are NOT covered by the signature, so anything derived from them can
// be changed by an attacker without breaking verification.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SECRET = 'test-webhook-secret-at-least-32-chars-long';
vi.mock('../config.js', () => ({
  config: { webhookSecret: 'test-webhook-secret-at-least-32-chars-long' },
}));

const { validateWebhook } = await import('./validateWebhook.js');

const sign = (ts, rawBody, secret = SECRET) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');

const nowSec = () => Math.floor(Date.now() / 1000);

function makeReq({ rawBody = '{"message":"hi"}', ts = nowSec(), sig, headers = {} } = {}) {
  return {
    rawBody,
    body: (() => { try { return JSON.parse(rawBody); } catch { return {}; } })(),
    headers: {
      'x-webhook-timestamp': String(ts),
      'x-webhook-signature': sig ?? sign(String(ts), rawBody),
      ...headers,
    },
  };
}

function makeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe('forgery is blocked — and stays blocked', () => {
  it('a correctly signed request passes', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    validateWebhook(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('a wrong signature is 401', () => {
    const req = makeReq({ sig: 'sha256=' + 'a'.repeat(64) });
    const res = makeRes();
    const next = vi.fn();
    validateWebhook(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('a signature over a DIFFERENT body is 401', () => {
    const ts = nowSec();
    const req = makeReq({ rawBody: '{"message":"evil"}', ts, sig: sign(String(ts), '{"message":"hi"}') });
    const res = makeRes();
    const next = vi.fn();
    validateWebhook(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('a signature made with another secret is 401', () => {
    const ts = nowSec();
    const req = makeReq({ ts, sig: sign(String(ts), '{"message":"hi"}', 'a-different-secret-of-sufficient-length') });
    const res = makeRes();
    const next = vi.fn();
    validateWebhook(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('a missing signature or timestamp is 401', () => {
    for (const drop of ['x-webhook-signature', 'x-webhook-timestamp']) {
      const req = makeReq();
      delete req.headers[drop];
      const res = makeRes();
      const next = vi.fn();
      validateWebhook(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  it('a timestamp outside the five-minute window is 401', () => {
    const old = nowSec() - 301;
    const req = makeReq({ ts: old });
    const res = makeRes();
    const next = vi.fn();
    validateWebhook(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('a timestamp moved after signing is 401 — the timestamp is signed material', () => {
    const ts = nowSec();
    const req = makeReq({ ts });
    req.headers['x-webhook-timestamp'] = String(ts - 1); // still inside the window
    const res = makeRes();
    const next = vi.fn();
    validateWebhook(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── THE ORDERING GUARD ──────────────────────────────────────────────────────
// The verifier must never be reachable without the bounded capture having run.
// Re-serialising an already-parsed body as a fallback cannot reproduce the
// sender's bytes, so it can only ever mask a mounting mistake — and the mistake
// it masks is the one this slice exists to prevent.
describe('verification refuses to run on unbounded or unavailable material', () => {
  it('an absent rawBody is refused, not guessed at from req.body', () => {
    const req = makeReq();
    delete req.rawBody;
    const res = makeRes();
    const next = vi.fn();
    validateWebhook(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalled();
    expect(res.status.mock.calls[0][0]).not.toBe(200);
  });

  it('a non-string rawBody is refused', () => {
    const req = makeReq();
    req.rawBody = { not: 'a string' };
    const res = makeRes();
    const next = vi.fn();
    validateWebhook(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── THE SIGNED IDENTITY ─────────────────────────────────────────────────────
// What the next middleware is allowed to make an idempotency decision from.
describe('a verified request carries its signed identity forward', () => {
  it('marks the request verified', () => {
    const req = makeReq();
    validateWebhook(req, makeRes(), vi.fn());
    expect(req.webhookVerified).toBe(true);
    expect(req.webhookSignedDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an unverified request carries neither', () => {
    const req = makeReq({ sig: 'sha256=' + 'b'.repeat(64) });
    validateWebhook(req, makeRes(), vi.fn());
    expect(req.webhookVerified).not.toBe(true);
    expect(req.webhookSignedDigest).toBeUndefined();
  });

  it('the same signed material yields the same digest — an exact replay is recognisable', () => {
    const ts = nowSec();
    const a = makeReq({ ts });
    const b = makeReq({ ts });
    validateWebhook(a, makeRes(), vi.fn());
    validateWebhook(b, makeRes(), vi.fn());
    expect(a.webhookSignedDigest).toBe(b.webhookSignedDigest);
  });

  // The digest must cover ALL the signed material, not just the body. A digest
  // over the body alone would make two legitimately distinct deliveries of the
  // same payload — a resend with a fresh timestamp — indistinguishable, and the
  // second would be refused as a replay it is not.
  it('the timestamp is part of the digest', () => {
    const ts = nowSec();
    const a = makeReq({ ts, rawBody: '{"message":"same"}' });
    const b = makeReq({ ts: ts - 10, rawBody: '{"message":"same"}' });
    validateWebhook(a, makeRes(), vi.fn());
    validateWebhook(b, makeRes(), vi.fn());
    expect(a.webhookVerified).toBe(true);
    expect(b.webhookVerified).toBe(true);
    expect(a.webhookSignedDigest).not.toBe(b.webhookSignedDigest);
  });

  it('a different body yields a different digest', () => {
    const ts = nowSec();
    const a = makeReq({ ts, rawBody: '{"message":"one"}' });
    const b = makeReq({ ts, rawBody: '{"message":"two"}' });
    validateWebhook(a, makeRes(), vi.fn());
    validateWebhook(b, makeRes(), vi.fn());
    expect(a.webhookSignedDigest).not.toBe(b.webhookSignedDigest);
  });

  // The digest must not be the HMAC itself: the HMAC travels in a header in the
  // clear, so an attacker knows it. Storing a plain digest of the signed
  // material keeps the persisted idempotency key independent of the secret.
  it('the digest is not the signature', () => {
    const req = makeReq();
    validateWebhook(req, makeRes(), vi.fn());
    expect(req.headers['x-webhook-signature']).not.toContain(req.webhookSignedDigest);
  });

  // Unsigned headers cannot influence it, which is the whole reason the next
  // middleware is allowed to trust it.
  it('an unsigned header does not change the digest', () => {
    const ts = nowSec();
    const a = makeReq({ ts });
    const b = makeReq({ ts, headers: { 'x-webhook-event-id': 'attacker-chosen', 'x-webhook-provider': 'meta' } });
    validateWebhook(a, makeRes(), vi.fn());
    validateWebhook(b, makeRes(), vi.fn());
    expect(a.webhookSignedDigest).toBe(b.webhookSignedDigest);
  });
});
