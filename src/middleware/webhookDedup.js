// ============================================================
// Webhook idempotency — over SIGNED material only
// ============================================================
// SECURITY SLICE A. This middleware used to build its identity from
// `x-webhook-provider` and `x-webhook-event-id`, preferring both over the body,
// and to skip deduplication entirely when neither was present.
//
// The signature covers "<timestamp>.<raw body>". EVERY OTHER HEADER IS UNSIGNED.
// So an attacker holding one captured valid request could replay it with a
// fresh event-id header each time and defeat deduplication completely — and a
// sender that correctly signed its event id in the BODY had that value
// overridden by the unsigned header, because the header was consulted first.
//
//   request → bounded capture → signature → SIGNED IDENTITY (here) → mutation
//
// Two claims now happen, in this order:
//
//   1. THE REPLAY CLAIM, on `webhookSignedDigest`. It always applies, so there
//      is no longer any request that passes through un-deduplicated. A request
//      that declares no provider or event id is not unprotected; it is
//      identified by exactly what was signed. That is the fail-closed default
//      the old `return next()` gave away.
//
//   2. THE PROVIDER EVENT CLAIM, from the SIGNED BODY only. This is the durable
//      per-provider record, and it is unchanged in purpose. An unrecognised
//      provider is still not persisted under a guessed one — but it no longer
//      means "not deduplicated", because claim 1 already covered it.
//
// The middleware refuses to run at all unless verification has already
// happened. A guard whose correctness depends on running second should say so
// rather than assume it.
// ============================================================
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { claimOnce } from './webhookReplayStore.js';
import { REPLAY_WINDOW_MS } from './validateWebhook.js';

const PROVIDERS = new Set(['META', 'GOOGLE']);

function normalizeProvider(value) {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'FACEBOOK' || normalized === 'INSTAGRAM') return 'META';
  return PROVIDERS.has(normalized) ? normalized : null;
}

/**
 * The provider event identity, read from the SIGNED body and nowhere else.
 * Headers are not consulted: they are outside the signature, so a value taken
 * from one is attacker-chosen even on a perfectly verified request.
 */
function resolveWebhookIdentity(req) {
  const body = req.body || {};
  const provider = normalizeProvider(body.provider || body.platform || body.source);
  const externalEventId = body.eventId || body.event_id || body.id;

  return {
    provider,
    externalEventId: externalEventId ? String(externalEventId) : null,
  };
}

export async function dedupeWebhookEvent(req, res, next) {
  // ── Ordering guard ────────────────────────────────────────
  if (req.webhookVerified !== true || typeof req.webhookSignedDigest !== 'string') {
    logger.error({ path: req.path }, '[webhook-dedup] reached without a verified signature — refusing');
    return res.status(500).json({
      status: 'error',
      message: 'Webhook idempotency is misconfigured.',
    });
  }

  // ── 1. Replay claim over the signed material ──────────────
  const fresh = await claimOnce(req.webhookSignedDigest, REPLAY_WINDOW_MS);
  if (!fresh) {
    logger.info({ path: req.path }, '[webhook-dedup] replay of already-processed signed request — skipped');
    return res.status(200).json({ status: 'duplicate', reason: 'REPLAY' });
  }

  // ── 2. Provider event claim, from the signed body ─────────
  const { provider, externalEventId } = resolveWebhookIdentity(req);

  if (!provider || !externalEventId) {
    logger.debug({
      path: req.path,
      provider,
      hasEventId: Boolean(externalEventId),
    }, '[webhook-dedup] no signed provider identity — covered by the replay claim');
    req.webhookEvent = null;
    return next();
  }

  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        externalEventId,
        payload: req.body || {},
        status: 'RECEIVED',
      },
    });
    req.webhookEvent = { provider, externalEventId };
    return next();
  } catch (err) {
    if (err.code === 'P2002') {
      logger.info({ provider, externalEventId }, '[webhook-dedup] duplicate event skipped');
      return res.status(200).json({
        status: 'duplicate',
        provider,
        externalEventId,
      });
    }

    logger.error({
      err: err.message,
      provider,
      externalEventId,
    }, '[webhook-dedup] failed');
    return res.status(500).json({
      status: 'error',
      message: 'Webhook deduplication failed.',
    });
  }
}
