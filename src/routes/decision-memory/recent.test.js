// ============================================================
// GET /api/decision-memory/recent — route tests
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import decisionMemoryRouter from './index.js';

vi.mock('../../middleware/firebaseAuth.js', () => ({
  firebaseAuthMiddleware: (req, _res, next) => {
    req.user = { uid: 'user-1' };
    req.workspaceId = 'ws-abc';
    req.userId = 'user-1';
    next();
  },
}));

vi.mock('../../middleware/contextGuard.js', () => ({
  contextGuard: (_req, _res, next) => next(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/decision-memory/index.js', () => ({
  decisionMemoryService: {
    getRecentMemories: vi.fn(),
  },
}));

import { decisionMemoryService } from '../../services/decision-memory/index.js';

const MEMORY_ROW = {
  id:            'mem-1',
  workspaceId:   'ws-abc',
  executionId:   'exec-1',
  correlationId: 'corr-1',
  decisionType:  'PAUSE_CAMPAIGN',
  signalType:    'LOW_CTR',
  diagnosis:     'weak creative hook',
  actionTaken:   'paused campaign camp-7',
  outcome:       'improved_ctr',
  confidence:    0.87,
  createdAt:     new Date('2026-05-24T12:00:00.000Z'),
};

describe('GET /api/decision-memory/recent', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/decision-memory', decisionMemoryRouter);
  });

  it('returns 200 with memories array and count', async () => {
    decisionMemoryService.getRecentMemories.mockResolvedValueOnce([MEMORY_ROW]);

    const res = await request(app)
      .get('/api/decision-memory/recent')
      .expect(200);

    expect(res.body.memories).toHaveLength(1);
    expect(res.body.count).toBe(1);
    expect(res.body.memories[0].id).toBe('mem-1');
  });

  it('is workspace-scoped — calls getRecentMemories with workspaceId from auth', async () => {
    decisionMemoryService.getRecentMemories.mockResolvedValueOnce([]);

    await request(app).get('/api/decision-memory/recent').expect(200);

    expect(decisionMemoryService.getRecentMemories).toHaveBeenCalledWith('ws-abc', 20);
  });

  it('returns empty array when no memories exist', async () => {
    decisionMemoryService.getRecentMemories.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/api/decision-memory/recent')
      .expect(200);

    expect(res.body.memories).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns 500 with MEMORY_FETCH_ERROR code on service failure', async () => {
    decisionMemoryService.getRecentMemories.mockRejectedValueOnce(new Error('DB exploded'));

    const res = await request(app)
      .get('/api/decision-memory/recent')
      .expect(500);

    expect(res.body.code).toBe('MEMORY_FETCH_ERROR');
    expect(res.body.error).toBeDefined();
  });

  it('returns memories in the order provided by the service', async () => {
    const rows = [
      { ...MEMORY_ROW, id: 'newest', createdAt: new Date('2026-05-24T13:00:00Z') },
      { ...MEMORY_ROW, id: 'older',  createdAt: new Date('2026-05-24T12:00:00Z') },
    ];
    decisionMemoryService.getRecentMemories.mockResolvedValueOnce(rows);

    const res = await request(app)
      .get('/api/decision-memory/recent')
      .expect(200);

    expect(res.body.memories[0].id).toBe('newest');
    expect(res.body.memories[1].id).toBe('older');
  });

  it('each memory row has expected fields', async () => {
    decisionMemoryService.getRecentMemories.mockResolvedValueOnce([MEMORY_ROW]);

    const res = await request(app)
      .get('/api/decision-memory/recent')
      .expect(200);

    const m = res.body.memories[0];
    expect(m).toHaveProperty('id');
    expect(m).toHaveProperty('executionId');
    expect(m).toHaveProperty('signalType');
    expect(m).toHaveProperty('diagnosis');
    expect(m).toHaveProperty('actionTaken');
    expect(m).toHaveProperty('outcome');
    expect(m).toHaveProperty('confidence');
  });
});
