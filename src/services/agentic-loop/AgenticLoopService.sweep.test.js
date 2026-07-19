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
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    action:              { findMany: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of ['decision', 'fatiguePrediction', 'testExperiment', 'plan', 'allocationPlan',
    'action', 'outcomeSnapshot', 'decisionMemoryEntry', 'account', 'campaign', 'adSet']) {
    prisma[model].findMany.mockResolvedValue([]);
  }
  prisma.workspace.findUnique.mockResolvedValue({ objective: null });
  prisma.loopRun.create.mockResolvedValue({ id: 'lr1' });
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

// The 24/7 token-burn fix: an ON_READ sweep (a plain home/agenda GET, throttled
// only by the 15-min window) must stay DETERMINISTIC — never fan out to the AI
// gateway. User-initiated + opt-in-cron sweeps still narrate.
describe('runSweep — ON_READ skips LLM narration (no automatic token spend)', () => {
  it('does NOT call the reasoning / portfolio-analysis LLM steps on ON_READ', async () => {
    const res = await runSweep(WS, { trigger: 'ON_READ', force: true });

    expect(generateReasoningForSweep).not.toHaveBeenCalled();
    expect(runPortfolioAnalysis).not.toHaveBeenCalled();
    // The deterministic agenda + audit are still produced (the read isn't blanked).
    expect(prisma.loopRun.create).toHaveBeenCalledTimes(1);
    expect(res.agenda).toBeDefined();
  });

  it('DOES call the LLM steps on a user-initiated MANUAL sweep (deliberate spend)', async () => {
    await runSweep(WS, { trigger: 'MANUAL', force: true });

    expect(generateReasoningForSweep).toHaveBeenCalledTimes(1);
    expect(runPortfolioAnalysis).toHaveBeenCalledTimes(1);
  });

  it('DOES narrate on a SCHEDULED sweep (opt-in cron — enabling it accepts the spend)', async () => {
    await runSweep(WS, { trigger: 'SCHEDULED', force: true });

    expect(generateReasoningForSweep).toHaveBeenCalledTimes(1);
    expect(runPortfolioAnalysis).toHaveBeenCalledTimes(1);
  });
});
