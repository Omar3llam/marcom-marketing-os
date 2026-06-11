import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupeWebhookEvent } from './webhookDedup.js';
import { prisma } from '../lib/prisma.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeReq({ headers = {}, body = {} } = {}) {
  return { headers, body, path: '/chat' };
}

function makeRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

describe('dedupeWebhookEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists Meta/Google webhook events and continues', async () => {
    const req = makeReq({
      headers: {
        'x-webhook-provider': 'meta',
        'x-webhook-event-id': 'evt-1',
      },
      body: { message: 'hello' },
    });
    const res = makeRes();
    const next = vi.fn();

    await dedupeWebhookEvent(req, res, next);

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: {
        provider: 'META',
        externalEventId: 'evt-1',
        payload: { message: 'hello' },
        status: 'RECEIVED',
      },
    });
    expect(req.webhookEvent).toEqual({ provider: 'META', externalEventId: 'evt-1' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('short-circuits duplicate event IDs', async () => {
    prisma.webhookEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    const req = makeReq({
      headers: {
        'x-webhook-provider': 'google',
        'x-webhook-event-id': 'evt-2',
      },
    });
    const res = makeRes();
    const next = vi.fn();

    await dedupeWebhookEvent(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'duplicate',
      provider: 'GOOGLE',
      externalEventId: 'evt-2',
    });
  });

  it('passes through generic webhooks without event IDs', async () => {
    const req = makeReq({ body: { message: 'generic n8n webhook' } });
    const res = makeRes();
    const next = vi.fn();

    await dedupeWebhookEvent(req, res, next);

    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
