// ============================================================
// B5-01D — the campaign read failure must reach the PRODUCT as a failure
// ============================================================
// The service-level suite proves getConnectorCampaigns throws. That is only half
// the invariant: a throw that a consumer converts back into an empty list has
// closed nothing. These are the two surfaces Discovery 01D caught lying, tested
// through their real routers.
//
//   Test 5 — GET /entities/campaigns answered HTTP 200 { campaigns: [] }.
//            The route HAS a 500 handler; it was unreachable, because the
//            service swallowed the rejection before it could run.
//
//   Test 6 — POST /copilot built a prompt saying "No campaigns synced yet" and
//            "the answer is 0 campaigns", then asked a model to say it.
//
// Test 6 asserts on the GATEWAY, not the status code. A route can return 500 and
// still have called the model first; the only proof that no fabricated
// population reached the AI layer is that no prompt was ever built.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findUnique: vi.fn().mockResolvedValue({ name: 'Acme', currency: 'EGP', objective: 'sales', industry: 'retail', market: 'EG' }) },
    loopRun:   { findFirst:  vi.fn().mockResolvedValue({ aiInsight: 'Two campaigns need attention.' }) },
    user:      { findUnique: vi.fn().mockResolvedValue({ workspaceId: 'ws1' }) },
    campaignReasoning: { findUnique: vi.fn() },
  },
}));

vi.mock('../../services/ai-gateway/ProviderGateway.js', () => ({ execute: vi.fn() }));
vi.mock('../../services/entity-graph/index.js', () => ({
  getConnectorCampaigns:      vi.fn(),
  getCanonicalVerdictCampaigns: vi.fn(),
  getCampaignAdSets:          vi.fn(),
  getAdSetAds:                vi.fn(),
}));
vi.mock('../../services/verdict-engine/index.js', () => ({
  getConnectorVerdicts: vi.fn(),
  needsRevenueData:     vi.fn(() => false),
  analyzeEvidence:      vi.fn(),
  isRankable:           vi.fn(() => true),
}));

import { execute } from '../../services/ai-gateway/ProviderGateway.js';
import { getConnectorCampaigns, getCanonicalVerdictCampaigns } from '../../services/entity-graph/index.js';
import { getConnectorVerdicts } from '../../services/verdict-engine/index.js';
import { CampaignsUnavailableError, CAMPAIGN_READ_FAILED } from '../../services/entity-graph/EntityGraphService.js';
import { copilotRouter } from './copilot.js';
import { entitiesRouter } from './entities.js';

function makeApp(router, { collabRole = 'STRATEGIST' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = 'ws1';
    req.collabRole = collabRole;
    next();
  });
  app.use('/', router);
  return app;
}

/** The real failure this slice introduces, arranged lazily (never as a
 *  pre-created rejected promise, and never returned from a hook). */
const failCampaignRead = () =>
  getConnectorCampaigns.mockImplementation(() =>
    Promise.reject(new CampaignsUnavailableError(undefined, { cause: new Error('connection terminated') })));

beforeEach(() => {
  vi.clearAllMocks();
  getConnectorVerdicts.mockResolvedValue({ verdicts: [] });
  getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: [], noCanonicalWindow: [] });
  execute.mockResolvedValue({ success: true, output: { answer: 'Here is your account.' }, metadata: {} });
});

// ── TEST 5 · the campaigns API ────────────────────────────────────────────────
describe('B5-01D · Test 5 — GET /entities/campaigns cannot answer 200 with a false empty population', () => {
  it('a failed read is NOT HTTP 200 { campaigns: [] }', async () => {
    failCampaignRead();
    const res = await request(makeApp(entitiesRouter)).get('/entities/campaigns');

    expect(res.status).not.toBe(200);
    expect(res.body.campaigns).toBeUndefined();
  });

  it('it maps to the route’s existing honest failure contract (500)', async () => {
    failCampaignRead();
    const res = await request(makeApp(entitiesRouter)).get('/entities/campaigns').expect(500);
    expect(res.body.error).toBe('EntitiesUnavailable');
    // No Prisma/DB internals, and not the raw error message either.
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|connection terminated|sql/i);
  });

  it('a GENUINELY empty workspace still gets 200 with an empty list', async () => {
    getConnectorCampaigns.mockResolvedValue([]);
    const res = await request(makeApp(entitiesRouter)).get('/entities/campaigns').expect(200);
    expect(res.body.campaigns).toEqual([]);
  });

  it('the fatigue surface cannot answer 200 with a false all-clear either', async () => {
    failCampaignRead();
    const res = await request(makeApp(entitiesRouter)).get('/entities/fatigue');
    expect(res.status).not.toBe(200);
    expect(res.body.forecast).toBeUndefined();
  });
});

// ── TEST 6 · the copilot ──────────────────────────────────────────────────────
describe('B5-01D · Test 6 — the copilot cannot turn a read failure into "0 campaigns"', () => {
  it('NO PROMPT IS BUILT — the model is never asked to describe a population we could not read', async () => {
    failCampaignRead();
    await request(makeApp(copilotRouter)).post('/copilot').send({ question: 'How many campaigns do I have?' });

    expect(execute).not.toHaveBeenCalled();
  });

  it('the request fails honestly instead of answering', async () => {
    failCampaignRead();
    const res = await request(makeApp(copilotRouter))
      .post('/copilot').send({ question: 'How many campaigns do I have?' }).expect(500);

    expect(res.body.error).toBe('CopilotError');
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|connection terminated/i);
  });

  it('THE FABRICATED ZERO — no prompt containing a campaign count can be constructed', async () => {
    failCampaignRead();
    await request(makeApp(copilotRouter)).post('/copilot').send({ question: 'How many campaigns?' });

    // Every prompt string the gateway would have received, had it been called.
    const prompts = execute.mock.calls.map((c) => JSON.stringify(c[0]?.input ?? {})).join('\n');
    expect(prompts).not.toMatch(/the answer is 0 campaigns/i);
    expect(prompts).not.toMatch(/No campaigns synced yet/i);
    expect(prompts).toBe('');
  });

  it('a GENUINELY empty account is still answered — absence is not an outage', async () => {
    getConnectorCampaigns.mockResolvedValue([]);
    const res = await request(makeApp(copilotRouter))
      .post('/copilot').send({ question: 'How many campaigns do I have?' }).expect(200);

    expect(res.body.answer).toBeTruthy();
    expect(execute).toHaveBeenCalledTimes(1);
    // And for a REAL empty account, saying "0 campaigns" is correct and must survive.
    const prompt = JSON.stringify(execute.mock.calls[0][0].input);
    expect(prompt).toMatch(/the answer is 0 campaigns/i);
  });

  it('a verdict failure still degrades gracefully — this slice did not make it fatal', async () => {
    getConnectorCampaigns.mockResolvedValue([
      { entityId: 'c1', name: 'Ramadan Wave', channel: 'meta', spendMinor: 500000, roas: 0.8, currency: 'EGP' },
    ]);
    getConnectorVerdicts.mockRejectedValue(new Error('verdict engine down'));

    const res = await request(makeApp(copilotRouter))
      .post('/copilot').send({ question: 'What should I kill?' }).expect(200);

    expect(res.body.answer).toBeTruthy();
    const prompt = JSON.stringify(execute.mock.calls[0][0].input);
    expect(prompt).toMatch(/VERDICTS: unavailable/i);
  });

  it('the failure is matched by CODE, so a renamed class cannot silently slip through', async () => {
    failCampaignRead();
    const err = await getConnectorCampaigns('ws1').catch((e) => e);
    expect(err.code).toBe(CAMPAIGN_READ_FAILED);
  });
});
