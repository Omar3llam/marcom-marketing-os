// ============================================================
// R13-D / B3-C — rollback is retired, and says so
// ============================================================
// This suite previously asserted the opposite of what it asserts now: that an
// ADMIN could roll back an action and that the inverse was enqueued. That
// behaviour was never real. The enqueue handed the work to actionWorker, whose
// executors returned `{ ok: true, result: { stub: true } }` without calling any
// ad platform, so the inverse reached EXECUTED_SUCCESS having changed nothing.
//
// The test that mattered most is the one that now cannot be written at all:
// there is no success path to assert.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { rollbackRouter, LEGACY_RETIRED_CODE } from './rollback.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user:   { findUnique: vi.fn() },
    action: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeApp({ role = 'ADMIN', userId = 'firebase-user-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = userId;
    req.userRole = role;
    req.workspaceId = 'workspace-1';
    next();
  });
  app.use('/rollback', rollbackRouter);
  return app;
}

const post = (opts) => request(makeApp(opts)).post('/rollback/action-1').send({});

describe('rollback refuses, explicitly', () => {
  it('answers 501 with a machine-readable code', async () => {
    const res = await post();
    expect(res.status).toBe(501);
    expect(res.body.error).toBe('RollbackUnsupported');
    expect(res.body.code).toBe(LEGACY_RETIRED_CODE);
  });

  it('never reports success — not ok, not rolledBack', async () => {
    // The assertion this file exists for. `{ ok: true, enqueued: true }` was
    // the old response, and it described work nothing would perform.
    const res = await post();
    expect(res.body.ok).toBeUndefined();
    expect(res.body.rolledBack).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/"enqueued":\s*true/);
  });

  it('says plainly that nothing was changed on the ad account', async () => {
    const res = await post();
    expect(res.body.message).toMatch(/nothing was changed/i);
  });

  it('writes NOTHING — no inverse action, no status change, no audit row', async () => {
    // Recording a rollback that did not happen is the same lie in a different
    // table. An AuditLog row saying "rollback: true" would outlive every other
    // trace of this request.
    await post();
    expect(prisma.action.create).not.toHaveBeenCalled();
    expect(prisma.action.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reads nothing either — no action lookup', async () => {
    await post();
    expect(prisma.action.findUnique).not.toHaveBeenCalled();
  });
});

describe('authorization is still enforced ahead of the refusal', () => {
  it('rejects an unauthenticated caller with 401, not 501', async () => {
    const res = await post({ userId: null });
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin with 403 before anything else', async () => {
    // Removing the gate "because the endpoint does nothing now" would quietly
    // widen who may probe it, and the next person to implement canonical
    // rollback here would inherit an open door.
    const res = await post({ role: 'MEMBER' });
    expect(res.status).toBe(403);
    expect(prisma.action.findUnique).not.toHaveBeenCalled();
  });
});
