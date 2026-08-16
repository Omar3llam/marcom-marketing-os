// ============================================================
// R7 — GET /api/lumi/decisions/recent
// ------------------------------------------------------------
// The canonical replacement for the sidebar's decision list. What it replaced
// is the reason this file is strict about fabrication: the old surface built a
// display string from legacy DecisionMemory rows and the client parsed a verdict
// back out of it with `line.includes('KILL')`, falling through to 'TEST'. Users
// were shown verdicts no engine ever issued, under campaign names that were not
// campaign names.
//
// So the assertions here are mostly about what the response must NOT contain:
// no derived verdicts, no placeholder names, no invented timestamps, and no row
// from another workspace.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getRecentDecisions } = vi.hoisted(() => ({ getRecentDecisions: vi.fn() }));
const { campaignFindMany } = vi.hoisted(() => ({ campaignFindMany: vi.fn() }));

vi.mock('../../services/decision-memory/decisionHistory.js', () => ({
  getRecentDecisions,
  RECENT_DECISIONS_LIMIT: 20,
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    campaign: { findMany: (...a) => campaignFindMany(...a) },
    decision: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('../../services/analysis/decisionLearning.js', () => ({ getSimilarOutcomes: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { decisionsRouter } from './decisions.js';

const ENTITY = '11111111-1111-1111-1111-111111111111';

function makeApp({ workspaceId = 'ws1', collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = workspaceId;
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', decisionsRouter);
  return app;
}

const row = (over = {}) => ({
  id: 'dec-1', entityId: ENTITY, entityLevel: 'CAMPAIGN',
  verdict: 'KILL', status: 'PROPOSED', diagnosis: 'Spend without return.',
  rootCause: 'CRITICAL_PERFORMANCE_DECLINE', confidence: 0.9, resolution: null,
  createdAt: new Date('2026-08-14T10:00:00.000Z'), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getRecentDecisions.mockResolvedValue([row()]);
  campaignFindMany.mockResolvedValue([{ id: ENTITY, name: 'Summer Launch' }]);
});

describe('R7 · GET /decisions/recent — states the row', () => {
  it('returns the engine\'s verdict and the resolved campaign name', async () => {
    const res = await request(makeApp()).get('/decisions/recent').expect(200);

    expect(res.body.decisions).toEqual([{
      id: 'dec-1',
      entityId: ENTITY,
      entityLevel: 'CAMPAIGN',
      verdict: 'KILL',
      status: 'PROPOSED',
      campaign: 'Summer Launch',
      decidedAt: '2026-08-14T10:00:00.000Z',
    }]);
  });

  it('does not leak the prompt-only fields into a client payload', async () => {
    // The canonical read serves the orchestrator too, so it selects diagnosis,
    // rootCause and confidence. None of them belong on this surface.
    const res = await request(makeApp()).get('/decisions/recent').expect(200);
    for (const k of ['diagnosis', 'rootCause', 'confidence', 'resolution']) {
      expect(res.body.decisions[0]).not.toHaveProperty(k);
    }
  });

  it('reads the workspace from auth, never from the caller', async () => {
    await request(makeApp({ workspaceId: 'ws-real' }))
      .get('/decisions/recent?workspaceId=ws-attacker')
      .expect(200);

    expect(getRecentDecisions).toHaveBeenCalledWith('ws-real', 20);
  });

  it('scopes the NAME lookup to the workspace as well as the id', async () => {
    // An id alone is a caller-independent key. Resolving names by id only would
    // let a decision row name an entity from another workspace.
    await request(makeApp({ workspaceId: 'ws-real' })).get('/decisions/recent').expect(200);
    expect(campaignFindMany.mock.calls[0][0].where.workspaceId).toBe('ws-real');
  });
});

describe('R7 · GET /decisions/recent — refuses to invent', () => {
  it('an unnamed entity is null, NOT "Unknown"', async () => {
    campaignFindMany.mockResolvedValue([]); // no matching campaign row
    const res = await request(makeApp()).get('/decisions/recent').expect(200);

    expect(res.body.decisions[0].campaign).toBeNull();
    expect(res.body.decisions[0].campaign).not.toBe('Unknown');
  });

  it('NEVER derives a verdict from any text on the row', async () => {
    // The old surface would have read 'KILL' out of this diagnosis. The verdict
    // column says HOLD, and the column is the answer.
    getRecentDecisions.mockResolvedValue([row({ verdict: 'HOLD', diagnosis: 'Considered KILL, rejected.' })]);
    const res = await request(makeApp()).get('/decisions/recent').expect(200);
    expect(res.body.decisions[0].verdict).toBe('HOLD');
  });

  it('no decisions → an empty list, not a placeholder row', async () => {
    getRecentDecisions.mockResolvedValue([]);
    const res = await request(makeApp()).get('/decisions/recent').expect(200);
    expect(res.body.decisions).toEqual([]);
    // …and it must not have gone looking for names it does not need.
    expect(campaignFindMany).not.toHaveBeenCalled();
  });

  it('no workspace yet → empty list rather than a 401 during onboarding', async () => {
    const res = await request(makeApp({ workspaceId: null })).get('/decisions/recent').expect(200);
    expect(res.body.decisions).toEqual([]);
    expect(getRecentDecisions).not.toHaveBeenCalled();
  });

  it('a failed read is a 500 — NOT an empty list', async () => {
    // "No decisions yet" is a statement about the account. Rendering it because
    // our own query failed is the exact class of lie R7 exists to remove.
    getRecentDecisions.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp()).get('/decisions/recent').expect(500);
    expect(res.body.error).toBe('DecisionsUnavailable');
    expect(res.body).not.toHaveProperty('decisions');
  });

  it('only campaign-level rows are name-resolved, and non-campaign rows survive', async () => {
    getRecentDecisions.mockResolvedValue([row({ id: 'd2', entityLevel: 'ADSET' })]);
    const res = await request(makeApp()).get('/decisions/recent').expect(200);

    expect(campaignFindMany).not.toHaveBeenCalled();
    expect(res.body.decisions[0].campaign).toBeNull();
    expect(res.body.decisions[0].verdict).toBe('KILL');
  });
});

describe('R7 · GET /decisions/recent — reachable by every seat', () => {
  it('is not behind the OPERATORS write gate', async () => {
    // The surface it replaces sat behind requireAuth alone and the sidebar
    // renders for every seat. Gating reads here would blank the panel for a
    // CLIENT and call it a migration.
    for (const collabRole of ['CLIENT', 'BUYER', 'STRATEGIST', undefined]) {
      const res = await request(makeApp({ collabRole })).get('/decisions/recent');
      expect(res.status).toBe(200);
    }
  });
});
