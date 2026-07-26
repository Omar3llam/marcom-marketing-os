// ============================================================
// POST /api/lumi/copilot — account-aware Q&A route
// ------------------------------------------------------------
// Real requireCollabRole + copilotLimiter run; prisma, the AI gateway, and the
// connector reads are mocked so no test touches a DB or Claude. Asserts the
// role gate, input validation, the success passthrough, honest failure mapping,
// and that live account context is injected into the system prompt.
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
  },
}));

vi.mock('../../services/ai-gateway/ProviderGateway.js', () => ({ execute: vi.fn() }));
vi.mock('../../services/entity-graph/index.js', () => ({ getConnectorCampaigns: vi.fn() }));
vi.mock('../../services/verdict-engine/index.js', () => ({ getConnectorVerdicts: vi.fn() }));

import { execute } from '../../services/ai-gateway/ProviderGateway.js';
import { getConnectorCampaigns } from '../../services/entity-graph/index.js';
import { getConnectorVerdicts } from '../../services/verdict-engine/index.js';
import { copilotRouter } from './copilot.js';

function makeApp({ collabRole = 'STRATEGIST' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = 'ws1';
    req.collabRole = collabRole;
    next();
  });
  app.use('/', copilotRouter);
  return app;
}

const okGateway = () => execute.mockResolvedValue({ success: true, output: { answer: 'CPA rose on Ramadan Wave; consider pausing it.' }, metadata: {} });

describe('POST /copilot — Q&A route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectorCampaigns.mockResolvedValue([]);
    getConnectorVerdicts.mockResolvedValue({ verdicts: [] });
    okGateway();
  });

  it('STRATEGIST gets a grounded answer', async () => {
    const res = await request(makeApp()).post('/copilot').send({ question: 'Why did CPA jump?' }).expect(200);
    expect(res.body.answer).toMatch(/Ramadan Wave/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('lets a BUYER through the gate', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).post('/copilot').send({ question: 'Which to pause?' });
    expect(res.status).toBe(200);
  });

  it('403s a CLIENT at the role gate', async () => {
    const res = await request(makeApp({ collabRole: 'CLIENT' })).post('/copilot').send({ question: 'Anything?' }).expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(execute).not.toHaveBeenCalled();
  });

  it('400s an empty question', async () => {
    await request(makeApp()).post('/copilot').send({ question: '   ' }).expect(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('400s a question over 500 chars', async () => {
    await request(makeApp()).post('/copilot').send({ question: 'a'.repeat(501) }).expect(400);
  });

  it('400s a history longer than 20 turns', async () => {
    const history = Array.from({ length: 21 }, (_, i) => ({ role: 'user', content: `q${i}` }));
    await request(makeApp()).post('/copilot').send({ question: 'ok', history }).expect(400);
  });

  it('502s honestly when the gateway returns no answer', async () => {
    execute.mockResolvedValue({ success: false, error: { message: 'no api key' }, metadata: {} });
    const res = await request(makeApp()).post('/copilot').send({ question: 'Why?' }).expect(502);
    expect(res.body.error).toBe('CopilotUnavailable');
  });

  it('injects live account context (workspace + campaign + verdict) into the system prompt', async () => {
    getConnectorCampaigns.mockResolvedValue([
      { entityId: 'c1', name: 'Ramadan Wave', channel: 'meta', objective: 'conversions', roas: 0.8, ctr: 0.012, frequency: 4.2, spendMinor: 500000, currency: 'EGP' },
      { entityId: 'c2', name: 'Low Spender', channel: 'meta', roas: 3, spendMinor: 100, currency: 'EGP' },
    ]);
    getConnectorVerdicts.mockResolvedValue({ verdicts: [{ id: 'c1', verdict: 'KILL', rationale: 'ROAS below breakeven' }] });

    await request(makeApp()).post('/copilot').send({ question: 'What should I do?' }).expect(200);

    const { input } = execute.mock.calls[0][0];
    expect(input.system).toContain('WORKSPACE: Acme');
    expect(input.system).toContain('Ramadan Wave (meta)');
    expect(input.system).toContain('→ KILL');            // verdict joined by entityId===id
    expect(input.system).toContain('ACCOUNT BRIEFING:');  // latest LoopRun.aiInsight injected
    expect(input.user).toBe('What should I do?');
  });

  // ── PR: portfolio context ────────────────────────────────────
  describe('portfolio context', () => {
    // Two campaigns clear the 1%-of-spend scoring floor; one is a KILL.
    const richCampaigns = [
      { entityId: 'c1', name: 'Ramadan Wave', channel: 'meta', objective: 'conversions', roas: 0.8, ctr: 0.012, frequency: 4.2, spendMinor: 500000, currency: 'EGP', conversions: 12, revenueMinor: 400000, impressions: 90000, clicks: 1080, lastDate: new Date('2026-07-20') },
      { entityId: 'c2', name: 'Eid Push', channel: 'meta', objective: 'conversions', roas: 4, ctr: 0.03, frequency: 1.2, spendMinor: 300000, currency: 'EGP', conversions: 40, revenueMinor: 1200000, impressions: 50000, clicks: 1500 },
      { entityId: 'c3', name: 'Zero Spender', channel: 'meta', roas: null, spendMinor: 0, currency: 'EGP' },
    ];
    const richVerdicts = { verdicts: [
      { id: 'c1', verdict: 'KILL', rationale: 'ROAS below breakeven' },
      { id: 'c2', verdict: 'SCALE', rationale: 'Strong ROAS' },
    ] };

    const systemFor = async () => {
      getConnectorCampaigns.mockResolvedValue(richCampaigns);
      getConnectorVerdicts.mockResolvedValue(richVerdicts);
      await request(makeApp()).post('/copilot').send({ question: 'How many campaigns?' }).expect(200);
      return execute.mock.calls[0][0].input.system;
    };

    it('reports totalCampaigns UNFILTERED — the zero-spend row still counts', async () => {
      const s = await systemFor();
      expect(s).toContain('of 3 by spend');   // 3 total…
      expect(s).toContain('top 2 of 3');      // …but only 2 have spend > 0
      expect(s).toContain('3 campaigns');     // the how-many answer
    });

    it('grounds the answer in the deterministic account health (computed, not fetched)', async () => {
      const s = await systemFor();
      expect(s).toContain('ACCOUNT HEALTH');
      expect(s).toMatch(/Score: \d+\/100/);
      expect(s).toContain('Wasted spend');
      expect(s).toContain('Campaigns to act on (KILL or REFRESH): 1');
      expect(s).toContain('Campaigns scaling well (SCALE): 1');
    });

    it('carries the widened metrics that make CPA derivable', async () => {
      const s = await systemFor();
      expect(s).toContain('Conversions: 12');
      expect(s).toContain('Conversions: 40');
      expect(s).toMatch(/Revenue: EGP/);
    });

    it('excludes lastDate — no date may imply a time window', async () => {
      const s = await systemFor();
      expect(s).not.toContain('2026-07-20');
      expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('keeps zero-spend campaigns out of the campaign list (existing behaviour)', async () => {
      const s = await systemFor();
      expect(s).not.toContain('Zero Spender');
    });

    it('degrades honestly when health cannot be computed (no spend anywhere)', async () => {
      getConnectorCampaigns.mockResolvedValue([{ entityId: 'c9', name: 'Nothing', channel: 'meta', spendMinor: 0, currency: 'EGP' }]);
      getConnectorVerdicts.mockResolvedValue({ verdicts: [] });
      await request(makeApp()).post('/copilot').send({ question: 'Status?' }).expect(200);
      const { input } = execute.mock.calls[0][0];
      expect(input.system).toContain('ACCOUNT HEALTH: unavailable');
      expect(input.system).toContain('No campaigns synced yet.');
    });
  });

  it('folds prior turns into the user prompt (multi-turn context)', async () => {
    await request(makeApp())
      .post('/copilot')
      .send({ question: 'Why that one?', history: [{ role: 'user', content: 'Which to pause?' }, { role: 'assistant', content: 'Ramadan Wave.' }] })
      .expect(200);
    const { input } = execute.mock.calls[0][0];
    expect(input.user).toContain('User: Which to pause?');
    expect(input.user).toContain('Current question: Why that one?');
  });
});
