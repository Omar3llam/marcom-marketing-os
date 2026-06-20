// ============================================================
// Approved-artifacts listing tests — workspace-wide publish surface
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    artifact: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('../../services/artifact-storage/index.js', () => ({ getArtifact: vi.fn() }));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { registerArtifactsRoute } from './artifacts.js';

const WS = 'test-workspace-123';

// `collabRole` is what firebaseAuth stamps on req; the real gate reads it.
function makeApp({ collabRole = 'STRATEGIST' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.workspaceId = WS;
    req.userId = 'firebase-uid-1';
    req.user = { uid: 'firebase-uid-1' };
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  const router = express.Router();
  registerArtifactsRoute(router);
  app.use('/api/execute', router);
  return app;
}

describe('GET /api/execute/artifacts/approved', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists only COMPLETED + APPROVED artifacts, workspace-scoped', async () => {
    prisma.artifact.findMany.mockResolvedValue([
      {
        id: 'artifact-1',
        nodeId: 'node-1',
        type: 'hook',
        createdAt: new Date(),
        approval: { id: 'ap-1', status: 'COMPLETED', decision: 'APPROVED' },
      },
    ]);
    prisma.artifact.count.mockResolvedValue(1);

    const res = await request(makeApp({ collabRole: 'STRATEGIST' }))
      .get('/api/execute/artifacts/approved')
      .expect(200);

    expect(res.body.artifacts).toHaveLength(1);
    expect(res.body.artifacts[0].id).toBe('artifact-1');
    expect(res.body.artifacts[0].approval.decision).toBe('APPROVED');
    expect(res.body.pagination.total).toBe(1);

    // The filter must exclude pending/rejected and scope to the workspace.
    expect(prisma.artifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: WS,
          approval: { status: 'COMPLETED', decision: 'APPROVED' },
        },
      })
    );
  });

  it('returns an empty list (not an error) when nothing is approved yet', async () => {
    prisma.artifact.findMany.mockResolvedValue([]);
    prisma.artifact.count.mockResolvedValue(0);

    const res = await request(makeApp())
      .get('/api/execute/artifacts/approved')
      .expect(200);

    expect(res.body.artifacts).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.hasMore).toBe(false);
  });

  it('allows a BUYER (the operator who runs/records ads)', async () => {
    prisma.artifact.findMany.mockResolvedValue([]);
    prisma.artifact.count.mockResolvedValue(0);

    await request(makeApp({ collabRole: 'BUYER' }))
      .get('/api/execute/artifacts/approved')
      .expect(200);
  });

  it('forbids a CLIENT (read-only seat) — no publish action to take', async () => {
    await request(makeApp({ collabRole: 'CLIENT' }))
      .get('/api/execute/artifacts/approved')
      .expect(403);

    expect(prisma.artifact.findMany).not.toHaveBeenCalled();
  });

  it("does not let 'approved' get matched as an artifact :id", async () => {
    // If the literal route were registered after /artifacts/:id, this would
    // hit the single-artifact handler (findUnique). It must not.
    prisma.artifact.findMany.mockResolvedValue([]);
    prisma.artifact.count.mockResolvedValue(0);

    await request(makeApp())
      .get('/api/execute/artifacts/approved')
      .expect(200);

    expect(prisma.artifact.findUnique).not.toHaveBeenCalled();
  });
});
