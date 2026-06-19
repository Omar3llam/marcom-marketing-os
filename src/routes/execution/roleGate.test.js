// ============================================================
// Execution mutation routes — collab-role gate (security)
// ------------------------------------------------------------
// POST /meta, /:id/retry, /:id/resume all queue or drive a real Meta
// mutation. They are BUYER/STRATEGIST capabilities — a read-only CLIENT
// seat must be 403'd at the gate, before any execution work runs. The
// REAL requireCollabRole executes here; only the heavy deps are mocked.
// ============================================================
import express, { Router } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    executionRequest: {
      findUnique: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 'e1', workspaceId: 'ws1', version: 1, correlationId: 'k1' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock('../../queues/index.js', () => ({
  executionQueue: { count: vi.fn().mockResolvedValue(0) },
  enqueueExecution: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: { transition: vi.fn().mockResolvedValue({ version: 2 }) },
}));
vi.mock('../../services/execution/ExecutionResumeService.js', () => ({
  resumeWithDecisions: vi.fn().mockResolvedValue({ status: 'RESUMED' }),
  ResumeError: class ResumeError extends Error {
    constructor(statusCode, body) { super('resume'); this.statusCode = statusCode; this.body = body; }
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { registerMetaRoute } from './meta.js';
import { registerRetryRoute } from './retry.js';
import { registerResumeRoute } from './resume.js';

function makeApp({ collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.user = { uid: 'firebase-user-1' };
    req.workspaceId = 'ws1';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  const router = Router();
  registerMetaRoute(router);
  registerRetryRoute(router);
  registerResumeRoute(router);
  app.use('/execute', router);
  return app;
}

// path + a body that would otherwise be valid, so an allowed role gets past the
// gate and lands on the handler (proving the gate is what blocks, nothing else).
const ROUTES = [
  { path: '/execute/meta',        body: { actionType: 'PAUSE_CAMPAIGN', targetId: 't1', targetType: 'campaign', idempotencyKey: 'k1' } },
  { path: '/execute/exec-1/retry', body: {} },
  { path: '/execute/exec-1/resume', body: { decisions: [] } },
];

describe('execution mutation routes — BUYER/STRATEGIST gate', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const r of ROUTES) {
    it(`403s a CLIENT on POST ${r.path}`, async () => {
      const res = await request(makeApp({ collabRole: 'CLIENT' })).post(r.path).send(r.body).expect(403);
      expect(res.body.error).toBe('RoleForbidden');
    });

    it(`lets a STRATEGIST past the gate on POST ${r.path}`, async () => {
      const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post(r.path).send(r.body);
      expect(res.status).not.toBe(403);
    });

    it(`lets a BUYER past the gate on POST ${r.path}`, async () => {
      const res = await request(makeApp({ collabRole: 'BUYER' })).post(r.path).send(r.body);
      expect(res.status).not.toBe(403);
    });
  }

  it('treats a null collab role as STRATEGIST (legacy seats not locked out)', async () => {
    const res = await request(makeApp({ collabRole: null })).post('/execute/meta').send(ROUTES[0].body);
    expect(res.status).not.toBe(403);
  });
});
