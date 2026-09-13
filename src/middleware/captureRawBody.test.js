// ============================================================
// captureRawBody — the body is bounded BEFORE anything is authenticated
// ------------------------------------------------------------
// This middleware is the FIRST thing on /webhook/*. It runs before the HMAC is
// verified, before express.json's 10 MB limit, and before the rate limiter —
// so until it had a cap of its own, an unauthenticated caller could stream an
// unbounded body and have every byte buffered in memory before the signature
// was so much as looked at. The parser's limit does not protect it, because
// the parser is behind it.
//
//   request → BOUNDED capture → signature → signed identity → mutation
//
// Two things are asserted here and nowhere else:
//   • the cap is measured in BYTES. The original accumulated a string under
//     setEncoding('utf8'), which counts CHARACTERS — a multi-byte body is
//     larger in memory than the count that would have bounded it, and the
//     re-encoded string is not the bytes the sender signed.
//   • a body at or under the cap is preserved EXACTLY, or the verifier that
//     runs next would reject every legitimate request.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// config.js exits the process when a required env var is missing; this suite is
// about the byte cap, not the environment.
vi.mock('../config.js', () => ({
  config: { webhookSecret: 'test-webhook-secret-at-least-32-chars-long' },
}));

const { captureRawBody, WEBHOOK_MAX_BODY_BYTES } = await import('./validateWebhook.js');

function makeReq(chunks) {
  const req = Readable.from(chunks);
  req.headers = {};
  return req;
}

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

const run = (chunks) => new Promise((resolve) => {
  const req = makeReq(chunks);
  const res = makeRes();
  const next = vi.fn(() => resolve({ req, res, next, called: true }));
  captureRawBody(req, res, next);
  // A refusal never calls next(); resolve on the response instead.
  const originalJson = res.json;
  res.json = vi.fn((b) => { originalJson(b); resolve({ req, res, next, called: false }); return res; });
});

beforeEach(() => vi.clearAllMocks());

describe('the cap exists and is a real number', () => {
  it('exports a byte cap', () => {
    expect(typeof WEBHOOK_MAX_BODY_BYTES).toBe('number');
    expect(WEBHOOK_MAX_BODY_BYTES).toBeGreaterThan(0);
  });
});

describe('a body within the cap is preserved exactly', () => {
  it('rawBody is the bytes that arrived, and next() runs', async () => {
    const payload = JSON.stringify({ message: 'hello', n: 1 });
    const { req, res, called } = await run([Buffer.from(payload, 'utf8')]);
    expect(called).toBe(true);
    expect(req.rawBody).toBe(payload);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('a body split across chunks is reassembled byte-for-byte', async () => {
    const payload = JSON.stringify({ a: 'x'.repeat(500), b: 'y'.repeat(500) });
    const half = Math.floor(payload.length / 2);
    const { req } = await run([
      Buffer.from(payload.slice(0, half), 'utf8'),
      Buffer.from(payload.slice(half), 'utf8'),
    ]);
    expect(req.rawBody).toBe(payload);
  });

  // The HMAC is computed over these bytes. A multi-byte character that survives
  // the round trip is what makes a legitimate non-ASCII webhook verifiable.
  it('multi-byte UTF-8 survives intact', async () => {
    const payload = JSON.stringify({ message: 'مرحبا — ولا شيء ضاع', emoji: '🔒' });
    const { req } = await run([Buffer.from(payload, 'utf8')]);
    expect(req.rawBody).toBe(payload);
    expect(JSON.parse(req.rawBody).emoji).toBe('🔒');
  });

  it('still hands downstream handlers a parsed body', async () => {
    const { req } = await run([Buffer.from(JSON.stringify({ message: 'hi' }), 'utf8')]);
    expect(req.body).toEqual({ message: 'hi' });
  });

  it('a body that is not JSON parses to {} rather than throwing', async () => {
    const { req, called } = await run([Buffer.from('not json at all', 'utf8')]);
    expect(called).toBe(true);
    expect(req.body).toEqual({});
    expect(req.rawBody).toBe('not json at all');
  });
});

describe('a body over the cap is refused, unauthenticated, before verification', () => {
  it('answers 413 and never calls next()', async () => {
    const over = Buffer.alloc(WEBHOOK_MAX_BODY_BYTES + 1, 0x61);
    const { res, next } = await run([over]);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
  });

  // The point of a cap is that it acts at the crossing, not at end-of-stream.
  // A capture that buffered everything and measured afterwards would still
  // answer 413 — and would still have held the whole oversized body in memory,
  // which is the thing being prevented. So the assertion is on WHEN.
  it('refuses at the chunk that crosses the cap, while the stream is still open', async () => {
    const twoThirds = Math.ceil((WEBHOOK_MAX_BODY_BYTES * 2) / 3);
    const chunk = Buffer.alloc(twoThirds, 0x62);
    const req = new Readable({ read() {} }); // pushed by hand, never ended
    req.headers = {};
    const res = makeRes();
    const next = vi.fn();
    captureRawBody(req, res, next);

    const tick = () => new Promise((r) => setImmediate(r));

    req.push(chunk);          // two-thirds of the cap — under it
    await tick();
    expect(res.status).not.toHaveBeenCalled();

    req.push(chunk);          // four-thirds — crosses it
    await tick();
    expect(res.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
    // The stream never ended; the refusal did not wait for it.
    expect(req.rawBody).toBeUndefined();
  });

  it('answers exactly once even though more chunks follow', async () => {
    const chunk = Buffer.alloc(WEBHOOK_MAX_BODY_BYTES, 0x63);
    const { res } = await run([chunk, chunk, chunk]);
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  // The cap is on BYTES. A string-length cap would let a multi-byte body of
  // this size through, because it is under the cap in characters.
  it('counts bytes, not characters', async () => {
    // '€' is 3 bytes, 1 character. Just over the cap in bytes, a third of it
    // in characters.
    const chars = Math.ceil(WEBHOOK_MAX_BODY_BYTES / 3) + 1;
    const payload = Buffer.from('€'.repeat(chars), 'utf8');
    expect(payload.length).toBeGreaterThan(WEBHOOK_MAX_BODY_BYTES);
    const { res, next } = await run([payload]);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
  });
});
