// ============================================================
// R11-C — execution tenancy  (I65 / I70)
// ------------------------------------------------------------
// Two controls that fail if the tenancy work is reverted:
//   * the idempotency lookup is workspace-qualified, so a foreign key cannot
//     be used to read another workspace's execution or to fabricate a
//     "already succeeded" answer for them;
//   * a retry chain is bounded, so a real Meta mutation cannot be re-queued
//     indefinitely one click at a time.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user:             { findUnique: vi.fn().mockResolvedValue({ collabRole: 'STRATEGIST' }) },
    executionRequest: { findUnique: vi.fn(), create: vi.fn() },
    auditLog:         { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('../../queues/index.js', () => ({
  executionQueue: { count: vi.fn().mockResolvedValue(0) },
  enqueueExecution: vi.fn().mockResolvedValue({ id: 'job-1' }),
}));

vi.mock('../../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: { transition: vi.fn().mockResolvedValue({ version: 1 }) },
}));

vi.mock('../../services/execution/decisionAttribution.js', () => ({
  resolveAttribution: vi.fn().mockResolvedValue({ status: 'resolved', decisionId: null }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { registerMetaRoute }  from './meta.js';
import { registerRetryRoute } from './retry.js';
import { MAX_RETRY_DEPTH }    from './retry.js';

const WS_MINE = 'ws-mine';

function makeApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  router.use((req, _res, next) => {
    req.user = { uid: 'uid-1' };
    req.userId = 'uid-1';
    req.workspaceId = WS_MINE;
    req.collabRole = 'STRATEGIST';
    next();
  });
  registerMetaRoute(router);
  registerRetryRoute(router);
  app.use('/execute', router);
  return app;
}

const BODY = {
  actionType: 'PAUSE_CAMPAIGN',
  targetId: '120200000000000',
  targetType: 'campaign',
  idempotencyKey: 'key-shared-by-two-tenants',
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue({ collabRole: 'STRATEGIST' });
});

describe('idempotency is workspace-qualified (I65)', () => {
  // ── NC-B13 · the control ───────────────────────────────────
  it('looks the key up under (workspaceId, idempotencyKey), never globally', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue(null);
    prisma.executionRequest.create.mockResolvedValue({ id: 'e1', workspaceId: WS_MINE, version: 0, correlationId: 'c1' });

    await request(makeApp()).post('/execute/meta').send(BODY);

    expect(prisma.executionRequest.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_idempotencyKey: { workspaceId: WS_MINE, idempotencyKey: BODY.idempotencyKey } },
    });
    // The old shape would have been `{ where: { idempotencyKey } }` — a global
    // namespace shared by every tenant.
    const arg = prisma.executionRequest.findUnique.mock.calls[0][0];
    expect(arg.where.idempotencyKey).toBeUndefined();
  });

  it('still replays the caller\'s OWN key rather than double-executing', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: 'e-existing', status: 'EXECUTED_SUCCESS', response: { ok: true },
    });

    const res = await request(makeApp()).post('/execute/meta').send(BODY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ idempotentReplay: true, executionId: 'e-existing' });
    expect(prisma.executionRequest.create).not.toHaveBeenCalled();
  });

  it('a foreign key simply does not match — the request proceeds as new, leaking nothing', async () => {
    // With the scoped lookup, another tenant's key resolves to null here. The
    // caller learns nothing about them and gets their own fresh execution.
    prisma.executionRequest.findUnique.mockResolvedValue(null);
    prisma.executionRequest.create.mockResolvedValue({ id: 'e-new', workspaceId: WS_MINE, version: 0, correlationId: 'c2' });

    const res = await request(makeApp()).post('/execute/meta').send(BODY);

    expect(res.status).toBe(202);
    expect(res.body.idempotentReplay).toBeFalsy();
    expect(prisma.executionRequest.create).toHaveBeenCalledTimes(1);
  });
});

describe('retry chains are bounded (I70)', () => {
  function seedOriginal(retryMetadata) {
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: 'orig', workspaceId: WS_MINE, actionType: 'PAUSE_CAMPAIGN', targetId: '123',
      payload: {}, status: 'EXECUTED_FAILED', correlationId: 'c1', decisionId: null,
      retryMetadata,
    });
  }

  it('allows a first retry and records depth 1', async () => {
    seedOriginal(null);
    prisma.executionRequest.create.mockResolvedValue({ id: 'r1', workspaceId: WS_MINE, version: 0, correlationId: 'c1' });

    const res = await request(makeApp()).post('/execute/orig/retry').send({});

    expect(res.status).toBe(201);
    expect(prisma.executionRequest.create.mock.calls[0][0].data.retryMetadata.retryDepth).toBe(1);
  });

  it('increments the depth on each link of the chain', async () => {
    seedOriginal({ retryOf: 'older', retryDepth: 1 });
    prisma.executionRequest.create.mockResolvedValue({ id: 'r2', workspaceId: WS_MINE, version: 0, correlationId: 'c1' });

    await request(makeApp()).post('/execute/orig/retry').send({});

    expect(prisma.executionRequest.create.mock.calls[0][0].data.retryMetadata.retryDepth).toBe(2);
  });

  // ── NC-H7 · the control ────────────────────────────────────
  it('REFUSES once the chain depth is exhausted, and queues nothing', async () => {
    seedOriginal({ retryOf: 'older', retryDepth: MAX_RETRY_DEPTH });

    const res = await request(makeApp()).post('/execute/orig/retry').send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RETRY_DEPTH_EXCEEDED');
    expect(prisma.executionRequest.create).not.toHaveBeenCalled();
  });

  it('treats a malformed depth as zero rather than as unbounded', async () => {
    seedOriginal({ retryOf: 'older', retryDepth: 'lots' });
    prisma.executionRequest.create.mockResolvedValue({ id: 'r3', workspaceId: WS_MINE, version: 0, correlationId: 'c1' });

    const res = await request(makeApp()).post('/execute/orig/retry').send({});

    expect(res.status).toBe(201);
    expect(prisma.executionRequest.create.mock.calls[0][0].data.retryMetadata.retryDepth).toBe(1);
  });
});
