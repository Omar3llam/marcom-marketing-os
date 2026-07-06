// ============================================================
// POST /api/memory/record — workspace-pinning regression tests
// ------------------------------------------------------------
// Security regression (audit 2026-07): the handler used to build the
// service payload as { workspaceId, ...req.body }, so a client-supplied
// body.workspaceId silently overrode the caller's resolved workspace —
// an authenticated cross-workspace WRITE. The payload is now
// { ...req.body, workspaceId }: the resolved workspace always wins.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import memoryRouter from './memory.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    decisionMemory: { findMany: vi.fn() },
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/decision-memory/index.js', () => ({
  decisionMemoryService: {
    recordDecisionMemory: vi.fn(),
  },
}));

import { decisionMemoryService } from '../services/decision-memory/index.js';

const CALLER_WS  = 'ws-caller';
const FOREIGN_WS = 'ws-victim';

const VALID_BODY = {
  executionId:  'exec-1',
  decisionType: 'PAUSE_CAMPAIGN',
  signalType:   'LOW_CTR',
  diagnosis:    'weak creative hook',
  actionTaken:  'paused campaign camp-7',
  outcome:      'improved_ctr',
  confidence:   0.87,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  // Simulate firebaseAuthMiddleware having resolved the caller's workspace.
  app.use((req, _res, next) => {
    req.userId = 'user-1';
    req.workspaceId = CALLER_WS;
    next();
  });
  app.use('/api/memory', memoryRouter);
  return app;
}

describe('POST /api/memory/record — workspace pinning', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it('a foreign workspaceId in the body cannot override the caller workspace', async () => {
    decisionMemoryService.recordDecisionMemory.mockResolvedValueOnce({ id: 'mem-1' });

    await request(app)
      .post('/api/memory/record')
      .send({ ...VALID_BODY, workspaceId: FOREIGN_WS })
      .expect(201);

    expect(decisionMemoryService.recordDecisionMemory).toHaveBeenCalledTimes(1);
    const payload = decisionMemoryService.recordDecisionMemory.mock.calls[0][0];
    expect(payload.workspaceId).toBe(CALLER_WS);
    expect(payload.workspaceId).not.toBe(FOREIGN_WS);
  });

  it('records into the caller workspace on a normal body (no workspaceId sent)', async () => {
    decisionMemoryService.recordDecisionMemory.mockResolvedValueOnce({ id: 'mem-2' });

    const res = await request(app)
      .post('/api/memory/record')
      .send(VALID_BODY)
      .expect(201);

    expect(res.body).toEqual({ success: true, id: 'mem-2' });
    const payload = decisionMemoryService.recordDecisionMemory.mock.calls[0][0];
    expect(payload.workspaceId).toBe(CALLER_WS);
    expect(payload.executionId).toBe('exec-1');
  });

  it('body fields still pass through to the service unchanged', async () => {
    decisionMemoryService.recordDecisionMemory.mockResolvedValueOnce({ id: 'mem-3' });

    await request(app)
      .post('/api/memory/record')
      .send({ ...VALID_BODY, correlationId: 'corr-9' })
      .expect(201);

    const payload = decisionMemoryService.recordDecisionMemory.mock.calls[0][0];
    expect(payload).toMatchObject({ ...VALID_BODY, correlationId: 'corr-9', workspaceId: CALLER_WS });
  });

  it('validation errors from the service surface as 400', async () => {
    decisionMemoryService.recordDecisionMemory.mockRejectedValueOnce(new Error('executionId is required'));

    const res = await request(app)
      .post('/api/memory/record')
      .send({})
      .expect(400);

    expect(res.body.error).toContain('is required');
  });
});
