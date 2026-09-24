import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../middleware/requireCollabRole.js', () => ({
  resolveCollabRoleForDisplay: vi.fn().mockResolvedValue('STRATEGIST'),
  requireCollabRole: () => (_req, _res, next) => next(),
}));
vi.mock('../../services/agentic-loop/AgentHomeService.js', () => ({ getHome: vi.fn() }));
vi.mock('../../services/agentic-loop/AgenticLoopService.js', () => ({ runSweep: vi.fn(), getLoopState: vi.fn() }));

import { logger } from '../../utils/logger.js';
import { getHome } from '../../services/agentic-loop/AgentHomeService.js';
import { agenticRouter } from './agentic.js';

function app() {
  const server = express();
  server.use((req, _res, next) => { req.workspaceId = 'ws1'; next(); });
  server.use('/', agenticRouter);
  return server;
}

beforeEach(() => vi.resetAllMocks());

describe('GET /home error serialization', () => {
  it('publishes a genuinely empty successful Home', async () => {
    getHome.mockResolvedValue({
      role: 'STRATEGIST', summary: 'Nothing needs a decision right now — the loop is quiet.',
      buyerBand: { title: 'What needs a decision today', items: [], count: 0, empty: true },
      strategistBand: { title: 'How the portfolio is tracking to goal', items: [], count: 0, empty: true },
      loop: { stageStatus: [], closed: false, staleStages: [], loopHealth: 'STALLED', lastRunAt: null, nextRunAt: null, intervalMs: 900000 },
    });
    const response = await request(app()).get('/home').expect(200);
    expect(response.body.summary).toMatch(/quiet/);
    expect(response.body.buyerBand.items).toEqual([]);
  });

  it('publishes no agenda or private error when a required source fails', async () => {
    const failure = Object.assign(new Error('Home OUTCOMES read failed'), {
      source: 'OUTCOMES', cause: new Error('private database details'),
    });
    getHome.mockRejectedValue(failure);
    const response = await request(app()).get('/home').expect(500);
    expect(response.body).toEqual({ error: 'HomeUnavailable', message: 'Request failed' });
    expect(JSON.stringify(response.body)).not.toMatch(/OUTCOMES|private|quiet|closed|count/);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'OUTCOMES', wsId: 'ws1' }),
      '[lumi/agentic] home failed',
    );
  });
});
