// ============================================================
// AgenticLoopService.runSweep — the LoopRun audit-write projection
// ------------------------------------------------------------
// Regression: the manual "Run sweep" button (POST /api/lumi/loop/run) 500'd
// with "Request failed" on a DB where the ai_insight migration hadn't landed.
// Cause: loopRun.create had no `select`, so Prisma's default projection did
// INSERT ... RETURNING every scalar column — including the missing ai_insight —
// and the WRITE threw. (The READ paths, getLoopState/getHome, were already
// hardened; see AgentHomeService.resilience.test.js.) The fix: an explicit
// select on the create that OMITS aiInsight. This test locks in that the audit
// write never projects ai_insight, so a not-yet-migrated column can't crash it.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// buildLoopInputs wraps every source in safe(p, fallback), so unmocked reads
// degrade to empties rather than throwing — we only need loopRun + the models
// runSweep itself touches. force:true skips the idempotency findFirst.
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    loopRun:             { create: vi.fn(), findFirst: vi.fn() },
    decision:            { findMany: vi.fn() },
    fatiguePrediction:   { findMany: vi.fn() },
    testExperiment:      { findMany: vi.fn() },
    plan:                { findMany: vi.fn() },
    allocationPlan:      { findMany: vi.fn() },
    outcomeSnapshot:     { findMany: vi.fn() },
    decisionMemoryEntry: { findMany: vi.fn() },
    account:             { findMany: vi.fn() },
    campaign:            { findMany: vi.fn() },
    adSet:               { findMany: vi.fn() },
    workspace:           { findUnique: vi.fn() },
  },
}));

// The proposal-writing organs + the two best-effort dynamic-import services:
// mocked so the sweep runs without real DB/LLM work. Their failure is already
// caught in runSweep; here we just keep them quiet.
vi.mock('../guardrail-engine/GuardrailSweepService.js', () => ({ sweepGuardrails: vi.fn().mockResolvedValue() }));
vi.mock('../fatigue-forecaster/FatigueSweepService.js', () => ({ sweepFatigue: vi.fn().mockResolvedValue() }));
vi.mock('../verdict-engine/VerdictService.js', () => ({ persistConnectorVerdicts: vi.fn().mockResolvedValue() }));
vi.mock('../analysis/CampaignReasoningService.js', () => ({ generateReasoningForSweep: vi.fn().mockResolvedValue() }));
vi.mock('../analysis/PortfolioAnalysisService.js', () => ({ runPortfolioAnalysis: vi.fn().mockResolvedValue() }));

import { prisma } from '../../lib/prisma.js';
import { generateReasoningForSweep } from '../analysis/CampaignReasoningService.js';
import { runPortfolioAnalysis } from '../analysis/PortfolioAnalysisService.js';
import { runSweep } from './AgenticLoopService.js';

const WS = '7517d1b9-b967-44f3-a77f-60f5c577f867';
const ORIGINAL_AI = process.env.AI_AUTOMATIC_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_AUTOMATIC_ENABLED; // default: automatic AI OFF (manual-only)
  for (const model of ['decision', 'fatiguePrediction', 'testExperiment', 'plan', 'allocationPlan',
    'outcomeSnapshot', 'decisionMemoryEntry', 'account', 'campaign', 'adSet']) {
    prisma[model].findMany.mockResolvedValue([]);
  }
  prisma.workspace.findUnique.mockResolvedValue({ objective: null });
  prisma.loopRun.create.mockResolvedValue({ id: 'lr1' });
});

afterEach(() => {
  if (ORIGINAL_AI === undefined) delete process.env.AI_AUTOMATIC_ENABLED;
  else process.env.AI_AUTOMATIC_ENABLED = ORIGINAL_AI;
});

describe('runSweep — LoopRun audit projection', () => {
  it('writes the audit with an explicit select that OMITS aiInsight', async () => {
    await runSweep(WS, { trigger: 'MANUAL', force: true });

    expect(prisma.loopRun.create).toHaveBeenCalledTimes(1);
    const arg = prisma.loopRun.create.mock.calls[0][0];
    // The bug was a create with no select (default projection pulls every
    // column). The fix is an explicit select that never names ai_insight.
    expect(arg.select).toBeDefined();
    expect(arg.select).not.toHaveProperty('aiInsight');
    // The audit fields the sweep actually needs are still projected.
    expect(arg.select.id).toBe(true);
    expect(arg.select.loopHealth).toBe(true);
    expect(arg.select.stageStatus).toBe(true);
  });

  it('still writes the full audit payload (data is unchanged by the fix)', async () => {
    await runSweep(WS, { trigger: 'MANUAL', force: true });

    const { data } = prisma.loopRun.create.mock.calls[0][0];
    expect(data.workspaceId).toBe(WS);
    expect(data.trigger).toBe('MANUAL');
    expect(data).toHaveProperty('loopHealth');
    expect(data).toHaveProperty('proposalsByType');
  });
});

// Manual-only AI: the sweep's LLM narration (per-campaign reasoning + portfolio
// analysis) is the ONLY token spend, and by default it runs ONLY for a
// user-initiated MANUAL sweep. Every AUTOMATIC trigger skips it unless
// AI_AUTOMATIC_ENABLED=true — and an ON_READ home GET NEVER narrates, even then
// (a frontend poll / uptime monitor hitting it 24/7 must always stay free).
describe('runSweep — LLM narration is manual-only (no automatic token spend)', () => {
  const expectNarrated = (n) => {
    expect(generateReasoningForSweep).toHaveBeenCalledTimes(n);
    expect(runPortfolioAnalysis).toHaveBeenCalledTimes(n);
  };

  it('MANUAL (user-initiated) → narrates', async () => {
    await runSweep(WS, { trigger: 'MANUAL', force: true });
    expectNarrated(1);
  });

  it('ON_READ (home GET) → never narrates; the deterministic agenda still lands', async () => {
    const res = await runSweep(WS, { trigger: 'ON_READ', force: true });
    expectNarrated(0);
    expect(prisma.loopRun.create).toHaveBeenCalledTimes(1); // audit still written
    expect(res.agenda).toBeDefined();
  });

  it('SCHEDULED (agentic cron / post-sync) → does NOT narrate by default', async () => {
    await runSweep(WS, { trigger: 'SCHEDULED', force: true });
    expectNarrated(0);
    expect(prisma.loopRun.create).toHaveBeenCalledTimes(1); // deterministic sweep still ran
  });

  it('SCHEDULED + AI_AUTOMATIC_ENABLED=true → narrates (opt-in background spend)', async () => {
    process.env.AI_AUTOMATIC_ENABLED = 'true';
    await runSweep(WS, { trigger: 'SCHEDULED', force: true });
    expectNarrated(1);
  });

  it('ON_READ stays free even when AI_AUTOMATIC_ENABLED=true (a poll must never narrate)', async () => {
    process.env.AI_AUTOMATIC_ENABLED = 'true';
    await runSweep(WS, { trigger: 'ON_READ', force: true });
    expectNarrated(0);
  });

  it('only the literal "true" enables — "false" keeps SCHEDULED silent', async () => {
    process.env.AI_AUTOMATIC_ENABLED = 'false';
    await runSweep(WS, { trigger: 'SCHEDULED', force: true });
    expectNarrated(0);
  });
});
