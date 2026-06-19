// ============================================================
// Artifact-approval routes — STRATEGIST-only gate (security)
// ------------------------------------------------------------
// Approving / rejecting / requesting revision of an AI-generated artifact is
// an approval decision — STRATEGIST-only, mirroring canApprove and the plan
// approval gate. A CLIENT and a BUYER must both be 403'd at the gate.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/artifact-approval/index.js', () => ({
  approveArtifact: vi.fn(),
  rejectArtifact: vi.fn(),
  requestRevision: vi.fn(),
  getPendingApprovals: vi.fn(),
  getApprovalStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('../services/artifact-storage/index.js', () => ({
  getArtifact: vi.fn().mockResolvedValue({ id: 'a1', workspaceId: 'ws1' }),
}));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import artifactApprovalRouter from './artifact-approval.js';
import { approveArtifact, rejectArtifact, requestRevision } from '../services/artifact-approval/index.js';

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
  app.use('/', artifactApprovalRouter);
  return app;
}

const ROUTES = [
  { path: '/a1/approve',          body: { feedback: 'lgtm' } },
  { path: '/a1/reject',           body: { reason: 'off-brand' } },
  { path: '/a1/request-revision', body: { feedback: 'tighten the hook' } },
];

describe('artifact-approval routes — STRATEGIST-only gate', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const r of ROUTES) {
    it(`403s a CLIENT on POST ${r.path}`, async () => {
      const res = await request(makeApp({ collabRole: 'CLIENT' })).post(r.path).send(r.body).expect(403);
      expect(res.body.error).toBe('RoleForbidden');
    });

    it(`403s a BUYER on POST ${r.path}`, async () => {
      const res = await request(makeApp({ collabRole: 'BUYER' })).post(r.path).send(r.body).expect(403);
      expect(res.body.error).toBe('RoleForbidden');
    });
  }

  it('the blocked role never reaches the approval service', async () => {
    await request(makeApp({ collabRole: 'CLIENT' })).post('/a1/approve').send({ feedback: 'x' }).expect(403);
    expect(approveArtifact).not.toHaveBeenCalled();
    expect(rejectArtifact).not.toHaveBeenCalled();
    expect(requestRevision).not.toHaveBeenCalled();
  });

  it('lets a STRATEGIST past the gate (lands on the handler, not a 403)', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post('/a1/approve').send({ feedback: 'x' });
    expect(res.status).not.toBe(403);
  });
});
