// ============================================================
// dedupeWebhookEvent — idempotency rests on SIGNED material only
// ------------------------------------------------------------
// ⚠️ THE DEFECT WAS SPECIFIED HERE, NOT MERELY UNNOTICED.
//
// The three cases this file used to hold asserted the behaviour the security
// assessment later found:
//
//   it('persists Meta/Google webhook events and continues', …)
//       → built the identity from 'x-webhook-provider' + 'x-webhook-event-id'
//   it('short-circuits duplicate event IDs', …)
//       → same, from headers
//   it('passes through generic webhooks without event IDs', …)
//       → asserted that a request with no identity is NOT deduplicated at all
//
// The signature covers "<timestamp>.<raw body>". Every other header is unsigned.
// So an attacker replaying one captured valid request could change the unsigned
// event-id header on each replay and defeat deduplication entirely — and a
// sender that correctly signed its event id in the BODY had that value
// overridden by the unsigned header, because the header was consulted first.
//
// The precise statement of what the verifier gets right, and what it does not:
//
//   FORGERY                          blocked
//   REPLAY                           not blocked   ← this file closes it
//   EXHAUSTION BEFORE VERIFICATION   exposed       ← captureRawBody closes it
//
// All three cases are inverted below on the same fixtures.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { dedupeWebhookEvent } from './webhookDedup.js';
import { _resetReplayStore } from './webhookReplayStore.js';
import { prisma } from '../lib/prisma.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: { webhookEvent: { create: vi.fn() } },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The replay window is declared beside the verifier that enforces it — one
// source of truth — which pulls in config.js, and config.js exits the process
// when a required env var is missing. Mocked here because this suite is about
// idempotency, not the environment.
vi.mock('../config.js', () => ({
  config: { webhookSecret: 'test-webhook-secret-at-least-32-chars-long' },
}));

const digestOf = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * A request as it reaches this middleware: already verified, carrying the
 * digest of the material the signature covered.
 */
function makeReq({ headers = {}, body = {}, verified = true, signed = 'default-signed-material' } = {}) {
  return {
    headers,
    body,
    path: '/chat',
    webhookVerified: verified,
    webhookSignedDigest: verified ? digestOf(signed) : undefined,
  };
}

function makeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetReplayStore();
  prisma.webhookEvent.create.mockResolvedValue({});
});

// ── ORDERING ────────────────────────────────────────────────────────────────
// request → bounded capture → signature → signed identity → mutation.
// This middleware is the "signed identity" step, and it must refuse to be the
// first one.
describe('it refuses to run before verification', () => {
  it('an unverified request is denied, not passed through', async () => {
    const req = makeReq({ verified: false });
    const res = makeRes();
    const next = vi.fn();
    await dedupeWebhookEvent(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalled();
    expect(res.status.mock.calls[0][0]).not.toBe(200);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('a verified flag without a signed digest is still denied', async () => {
    const req = makeReq();
    delete req.webhookSignedDigest;
    const res = makeRes();
    const next = vi.fn();
    await dedupeWebhookEvent(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── REPLAY ──────────────────────────────────────────────────────────────────
describe('a replay of the same valid request does no work twice', () => {
  it('the first delivery proceeds', async () => {
    const next = vi.fn();
    await dedupeWebhookEvent(makeReq({ signed: 'req-A' }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('the same signed material a second time does NOT reach the handler', async () => {
    const first = vi.fn();
    await dedupeWebhookEvent(makeReq({ signed: 'req-A' }), makeRes(), first);
    expect(first).toHaveBeenCalledOnce();

    const res = makeRes();
    const second = vi.fn();
    await dedupeWebhookEvent(makeReq({ signed: 'req-A' }), res, second);
    expect(second).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // THE CLOSURE CONDITION. This is the exact attack: one captured valid
  // request, replayed with a fresh unsigned event-id header each time.
  it('changing the unsigned event-id header does not buy a second delivery', async () => {
    const next1 = vi.fn();
    await dedupeWebhookEvent(
      makeReq({ signed: 'req-A', headers: { 'x-webhook-event-id': 'first', 'x-webhook-provider': 'meta' } }),
      makeRes(), next1,
    );
    expect(next1).toHaveBeenCalledOnce();

    for (const forged of ['second', 'third', 'fourth']) {
      const res = makeRes();
      const next = vi.fn();
      await dedupeWebhookEvent(
        makeReq({ signed: 'req-A', headers: { 'x-webhook-event-id': forged, 'x-webhook-provider': 'meta' } }),
        res, next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    }
  });

  it('a genuinely different request is not mistaken for a replay', async () => {
    const a = vi.fn();
    const b = vi.fn();
    await dedupeWebhookEvent(makeReq({ signed: 'req-A' }), makeRes(), a);
    await dedupeWebhookEvent(makeReq({ signed: 'req-B' }), makeRes(), b);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});

// ── FAIL-CLOSED IDENTITY ────────────────────────────────────────────────────
// The old third case asserted that a request carrying no provider/event id was
// simply not deduplicated. There is no longer any such request: the signed
// digest is always an identity, so "no declared identity" degrades to
// "identified by what was signed", never to "unprotected".
describe('a request with no declared identity is still protected', () => {
  it('it proceeds the first time', async () => {
    const next = vi.fn();
    await dedupeWebhookEvent(makeReq({ body: { message: 'generic n8n webhook' }, signed: 'generic-1' }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('…and is refused on replay, with no provider row involved', async () => {
    await dedupeWebhookEvent(makeReq({ body: { message: 'generic n8n webhook' }, signed: 'generic-1' }), makeRes(), vi.fn());
    const res = makeRes();
    const next = vi.fn();
    await dedupeWebhookEvent(makeReq({ body: { message: 'generic n8n webhook' }, signed: 'generic-1' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });
});

// ── SIGNED IDENTITY FOR THE PROVIDER TABLE ──────────────────────────────────
describe('the provider event identity comes from the signed body, never a header', () => {
  it('a provider + event id in the BODY is persisted', async () => {
    const req = makeReq({ body: { provider: 'meta', eventId: 'evt-1', message: 'hello' }, signed: 'body-identity-1' });
    await dedupeWebhookEvent(req, makeRes(), vi.fn());
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: {
        provider: 'META',
        externalEventId: 'evt-1',
        payload: { provider: 'meta', eventId: 'evt-1', message: 'hello' },
        status: 'RECEIVED',
      },
    });
    expect(req.webhookEvent).toEqual({ provider: 'META', externalEventId: 'evt-1' });
  });

  it('an unsigned header does NOT supply an identity the body lacks', async () => {
    const req = makeReq({
      headers: { 'x-webhook-provider': 'meta', 'x-webhook-event-id': 'evt-from-header' },
      body: { message: 'hello' },
      signed: 'header-only-1',
    });
    const next = vi.fn();
    await dedupeWebhookEvent(req, makeRes(), next);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  // The sharper version of the case above: the body supplies a provider, so the
  // identity is half-formed, and only the event id is missing. A header allowed
  // to complete it would persist a row under an attacker-chosen key.
  it('an unsigned header does NOT complete a half-declared body identity', async () => {
    const req = makeReq({
      headers: { 'x-webhook-event-id': 'evt-from-header' },
      body: { provider: 'meta', message: 'hello' },   // provider, but no event id
      signed: 'half-identity-1',
    });
    const next = vi.fn();
    await dedupeWebhookEvent(req, makeRes(), next);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('…nor supply a provider the body omits', async () => {
    const req = makeReq({
      headers: { 'x-webhook-provider': 'meta' },
      body: { eventId: 'evt-9', message: 'hello' },   // event id, but no provider
      signed: 'half-identity-2',
    });
    const next = vi.fn();
    await dedupeWebhookEvent(req, makeRes(), next);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('an unsigned header does NOT override the identity the body declares', async () => {
    const req = makeReq({
      headers: { 'x-webhook-event-id': 'evt-from-header', 'x-webhook-provider': 'google' },
      body: { provider: 'meta', eventId: 'evt-from-body' },
      signed: 'override-attempt-1',
    });
    await dedupeWebhookEvent(req, makeRes(), vi.fn());
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: 'META', externalEventId: 'evt-from-body' }) }),
    );
  });

  it('a duplicate provider event id short-circuits with 200', async () => {
    prisma.webhookEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    const req = makeReq({ body: { provider: 'google', eventId: 'evt-2' }, signed: 'dup-provider-1' });
    const res = makeRes();
    const next = vi.fn();
    await dedupeWebhookEvent(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'duplicate', provider: 'GOOGLE', externalEventId: 'evt-2',
    }));
  });

  it('an unknown provider in the body is not persisted under a guessed one', async () => {
    const req = makeReq({ body: { provider: 'tiktok', eventId: 'evt-3' }, signed: 'unknown-provider-1' });
    const next = vi.fn();
    await dedupeWebhookEvent(req, makeRes(), next);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('a storage failure denies rather than letting the event through twice', async () => {
    prisma.webhookEvent.create.mockRejectedValueOnce(new Error('connection lost'));
    const req = makeReq({ body: { provider: 'meta', eventId: 'evt-4' }, signed: 'store-fail-1' });
    const res = makeRes();
    const next = vi.fn();
    await dedupeWebhookEvent(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
