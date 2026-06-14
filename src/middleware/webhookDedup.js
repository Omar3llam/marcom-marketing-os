import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

const PROVIDERS = new Set(['META', 'GOOGLE']);

function normalizeProvider(value) {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'FACEBOOK' || normalized === 'INSTAGRAM') return 'META';
  return PROVIDERS.has(normalized) ? normalized : null;
}

function resolveWebhookIdentity(req) {
  const body = req.body || {};
  const provider = normalizeProvider(
    req.headers['x-webhook-provider'] ||
    body.provider ||
    body.platform ||
    body.source
  );
  const externalEventId =
    req.headers['x-webhook-event-id'] ||
    body.eventId ||
    body.event_id ||
    body.id;

  return {
    provider,
    externalEventId: externalEventId ? String(externalEventId) : null,
  };
}

export async function dedupeWebhookEvent(req, res, next) {
  const { provider, externalEventId } = resolveWebhookIdentity(req);

  if (!provider || !externalEventId) {
    logger.debug({
      path: req.path,
      provider,
      hasEventId: Boolean(externalEventId),
    }, '[webhook-dedup] skipped: missing provider or event id');
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
