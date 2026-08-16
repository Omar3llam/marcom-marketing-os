// ============================================================
// R9 — POST /api/lumi/orchestrate/:campaignId · the identity boundary
// ------------------------------------------------------------
// `:campaignId` here is an EXTERNAL platform campaign string — the value stored
// on Action.campaignId and CampaignState.campaignId. It is NOT the canonical
// entity uuid that Decision.entityId and MetricSnapshot.entityId carry, even
// though a dozen other routes in this app name their uuid parameter `:id` or
// `:entityId` and one (`/entities/:campaignId/adsets`) uses this exact word for
// the OTHER type.
//
// The parameter name is not a type discriminator, so the boundary is asserted
// here instead: an entity uuid handed to this route must resolve to nothing and
// 404 — never be silently interpreted as an external id and orchestrated.
//
// R9 does not redesign this route. It pins what it already does, so a future
// "helpful" coercion between the two id types has to break a test first.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { actionFindFirst, userFindUnique } = vi.hoisted(() => ({
  actionFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
}));
const { executeOrchestration } = vi.hoisted(() => ({ executeOrchestration: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    action: { findFirst: (...a) => actionFindFirst(...a) },
    user:   { findUnique: (...a) => userFindUnique(...a) },
  },
}));
vi.mock('../../resilience/orchestratorCircuit.js', () => ({
  executeOrchestration: (...a) => executeOrchestration(...a),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { intelligenceRouter } from './intelligence.js';

const WS = 'ws1';
// What the platform gives us, and what Action.campaignId stores.
const EXTERNAL_CAMPAIGN_ID = '23851234567890123';
// What detId derives, and what Decision.entityId stores. Same concept to a
// human reading a URL; different identity type to the database.
const ENTITY_UUID = 'a3f1c2d4-1111-5aaa-8bbb-0123456789ab';

function makeApp({ workspaceId = WS } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = workspaceId;
    req.collabRole = 'STRATEGIST';
    next();
  });
  app.use('/', intelligenceRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  executeOrchestration.mockResolvedValue({ verdict: 'HOLD' });
  // The DB answers honestly: a PENDING Action exists for the EXTERNAL id only.
  actionFindFirst.mockImplementation(async ({ where }) => (
    where.workspaceId === WS && where.campaignId === EXTERNAL_CAMPAIGN_ID
      ? { id: 'action-1', campaignId: EXTERNAL_CAMPAIGN_ID }
      : null
  ));
});

describe('R9 · :campaignId is an EXTERNAL id, and only an external id', () => {
  it('orchestrates when given the external platform campaign id', async () => {
    const res = await request(makeApp())
      .post(`/orchestrate/${EXTERNAL_CAMPAIGN_ID}`)
      .send({})
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(executeOrchestration).toHaveBeenCalledTimes(1);
    expect(executeOrchestration.mock.calls[0][0]).toMatchObject({
      campaignId: EXTERNAL_CAMPAIGN_ID,
      workspaceId: WS,
    });
  });

  // NC14 — THE control. A canonical entity uuid is a legitimate identifier
  // elsewhere in this API, so the failure mode is not a malformed request: it is
  // a well-formed request naming the right campaign in the wrong identity type.
  it('404s on a canonical entity uuid — never coerces it to an external id', async () => {
    const res = await request(makeApp())
      .post(`/orchestrate/${ENTITY_UUID}`)
      .send({})
      .expect(404);

    expect(res.body.error).toMatch(/No PENDING action/i);
    // The load-bearing half: it must not have run anything.
    expect(executeOrchestration).not.toHaveBeenCalled();
  });

  it('looks the entity uuid up VERBATIM — no translation layer resolves it', async () => {
    await request(makeApp()).post(`/orchestrate/${ENTITY_UUID}`).send({}).expect(404);

    expect(actionFindFirst).toHaveBeenCalledTimes(1);
    const { where } = actionFindFirst.mock.calls[0][0];
    // Passed through as-is, and scoped. Nothing between the URL and the query
    // tried to map a uuid onto an external id, which is the "helpful" coercion
    // this test exists to forbid.
    expect(where.campaignId).toBe(ENTITY_UUID);
    expect(where.workspaceId).toBe(WS);
  });

  it('the Action lookup is workspace-scoped, so another workspace cannot be orchestrated', async () => {
    await request(makeApp({ workspaceId: 'ws-other' }))
      .post(`/orchestrate/${EXTERNAL_CAMPAIGN_ID}`)
      .send({})
      .expect(404);

    expect(executeOrchestration).not.toHaveBeenCalled();
  });

  it('threads the authenticated workspace, never one from the request', async () => {
    await request(makeApp())
      .post(`/orchestrate/${EXTERNAL_CAMPAIGN_ID}`)
      .send({ workspaceId: 'attacker-workspace' })
      .expect(200);

    expect(executeOrchestration.mock.calls[0][0].workspaceId).toBe(WS);
    expect(actionFindFirst.mock.calls[0][0].where.workspaceId).toBe(WS);
  });
});
