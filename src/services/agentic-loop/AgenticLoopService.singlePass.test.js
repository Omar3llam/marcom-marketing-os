// ============================================================
// R8 — ONE sweep, ONE verdict computation (I25 / I28)
// ------------------------------------------------------------
// This is the proof the whole change exists for, and it is deliberately NOT
// written against mocks of the things under test. The verdict engine, the
// connector verdict service, the persistence sink, the reasoning service and the
// portfolio service all run for real. Only the outside world is mocked: the
// evidence read, the database, and the AI gateway.
//
// WHAT IT COUNTS. getCanonicalVerdictCampaigns is the single evidence read every
// verdict computation must begin with — there is no path to a connector verdict
// that skips it. So its call count IS the number of verdict computations, and
// counting it needs no cooperation from the code under test.
//
// BEFORE R8, a MANUAL sweep called it FOUR times:
//   step 1  persistConnectorVerdicts   — read, build, roll up, rank, persist
//   step 2  buildLoopInputs → loadImpactById → getConnectorVerdicts
//   step 4  generateReasoningForSweep  → getConnectorVerdicts
//   step 5  runPortfolioAnalysis       → getConnectorVerdicts
// Four passes over the same question, at four different instants. They agreed
// whenever nothing changed in between — which is not the same as being correct,
// and is exactly the kind of agreement that stops holding on the day a sync
// lands mid-sweep and the stored Decision stops matching the narrated one.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The evidence read + the entity projection. The ONLY inputs to the verdict path.
const { getCanonicalVerdictCampaigns, getConnectorCampaigns } = vi.hoisted(() => ({
  getCanonicalVerdictCampaigns: vi.fn(),
  getConnectorCampaigns: vi.fn(),
}));
vi.mock('../entity-graph/index.js', () => ({
  getCanonicalVerdictCampaigns, getConnectorCampaigns,
  getCampaignAdSets: vi.fn(), getAdSetAds: vi.fn(), MAX_ADS_PER_ADSET: 50,
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    loopRun:             { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    decision:            { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    campaignReasoning:   { findMany: vi.fn(), upsert: vi.fn() },
    fatiguePrediction:   { findMany: vi.fn() },
    testExperiment:      { findMany: vi.fn() },
    // C-13 — the Experiment class's OTHER live object; buildLoopInputs reads both.
    incrementalityTest:  { findMany: vi.fn() },
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

// The two proposal organs R8 does not touch. Quiet, so the sweep runs.
vi.mock('../guardrail-engine/GuardrailSweepService.js', () => ({ sweepGuardrails: vi.fn().mockResolvedValue() }));
vi.mock('../fatigue-forecaster/FatigueSweepService.js', () => ({ sweepFatigue: vi.fn().mockResolvedValue() }));
vi.mock('../portfolio/PortfolioService.js', async (importOriginal) => ({ ...await importOriginal(), getPortfolio: vi.fn().mockResolvedValue(null) }));
vi.mock('../blended-truth/BlendedTruthService.js', async (importOriginal) => ({ ...await importOriginal(), getBlendedTruth: vi.fn().mockResolvedValue(null) }));
vi.mock('../test-generator/TestGeneratorService.js', async (importOriginal) => ({ ...await importOriginal(), getWeeklyAgenda: vi.fn().mockResolvedValue([]) }));

// The AI gateway, from BOTH the entry points its two consumers use.
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../ai-gateway/ProviderGateway.js', () => ({ execute }));
vi.mock('../ai-gateway/index.js', async (orig) => {
  const real = await orig();
  return { ...real, execute };
});

import { prisma } from '../../lib/prisma.js';
import { runSweep } from './AgenticLoopService.js';

const WS       = '7517d1b9-b967-44f3-a77f-60f5c577f867';
const CAMPAIGN = 'c1d2e3f4-0000-0000-0000-000000000010';
const ORIGINAL_AI = process.env.AI_AUTOMATIC_ENABLED;

// roas 4, ctr 5%, freq 1.5 → SCALE through the real engine.
const camp = (over = {}) => ({
  entityId: CAMPAIGN, name: 'Eid Sale', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 10000, revenueMinor: 40000, impressions: 1000, clicks: 50,
  conversions: 8, frequency: 1.5, ctr: 0.05, roas: 4, currency: 'USD', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$queryRaw = vi.fn(async () => [{ id: WS }]);
  prisma.$transaction = vi.fn(async (operation) => operation(prisma));
  delete process.env.AI_AUTOMATIC_ENABLED;

  getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: [camp()], noCanonicalWindow: [] });
  getConnectorCampaigns.mockResolvedValue([camp()]);

  for (const model of ['decision', 'fatiguePrediction', 'testExperiment', 'incrementalityTest', 'plan', 'allocationPlan',
    'outcomeSnapshot', 'decisionMemoryEntry', 'account', 'campaign', 'adSet', 'campaignReasoning']) {
    prisma[model].findMany.mockResolvedValue([]);
  }
  prisma.decision.findFirst.mockResolvedValue(null);
  prisma.decision.create.mockResolvedValue({});
  prisma.decision.updateMany.mockResolvedValue({ count: 0 });
  prisma.campaignReasoning.upsert.mockResolvedValue({});
  prisma.workspace.findUnique.mockResolvedValue({ objective: null, name: 'Acme', currency: 'USD' });
  prisma.loopRun.create.mockResolvedValue({ id: 'lr1' });
  prisma.loopRun.update.mockResolvedValue({});

  execute.mockResolvedValue({ success: true, output: { reasoning: 'because ROAS is 4x', insight: 'spend is working' } });
});

afterEach(() => {
  if (ORIGINAL_AI === undefined) delete process.env.AI_AUTOMATIC_ENABLED;
  else process.env.AI_AUTOMATIC_ENABLED = ORIGINAL_AI;
});

describe('R8 · one sweep computes connector verdicts exactly once', () => {
  // THE HEADLINE. A MANUAL sweep is the widest fan-out there is: persistence,
  // impact scoring, per-campaign reasoning and portfolio narration all consume
  // the verdicts.
  it('a MANUAL sweep — all four consumers — reads the evidence ONCE', async () => {
    await runSweep(WS, { trigger: 'MANUAL', force: true });

    expect(getCanonicalVerdictCampaigns).toHaveBeenCalledTimes(1);
    // …and the narrating steps really did run, so this is one computation shared
    // by four consumers, not one computation because three of them were skipped.
    expect(prisma.campaignReasoning.upsert).toHaveBeenCalled();     // step 4 ran
    expect(prisma.loopRun.update).toHaveBeenCalled();               // step 5 stored aiInsight
    expect(prisma.decision.create).toHaveBeenCalled();              // step 1 persisted
  });

  it('a SCHEDULED sweep (no narration) also reads the evidence ONCE', async () => {
    await runSweep(WS, { trigger: 'SCHEDULED', force: true });

    expect(getCanonicalVerdictCampaigns).toHaveBeenCalledTimes(1);
    expect(prisma.campaignReasoning.upsert).not.toHaveBeenCalled(); // narration off by default
  });

  // CONTROL 15 (live computation swapped for a stored/cached one). The verdict
  // persisted, the verdict reasoned about and the verdict narrated must be the
  // one the engine produced in THIS sweep — not a CampaignReasoning row from a
  // previous one, and not a Decision read back out of the database.
  it('the verdict that is stored is the verdict that is reasoned about', async () => {
    await runSweep(WS, { trigger: 'MANUAL', force: true });

    const stored = prisma.decision.create.mock.calls[0][0].data;
    const reasoned = prisma.campaignReasoning.upsert.mock.calls[0][0];
    expect(stored.verdict).toBe('SCALE');
    expect(reasoned.create.verdict).toBe(stored.verdict);
    expect(reasoned.create.entityId).toBe(stored.entityId);
  });

  // CONTROL 9/10 (missing data → invented verdict; failure → fallback verdict).
  it('a FAILED evaluation is carried, not retried, and invents nothing', async () => {
    getCanonicalVerdictCampaigns.mockRejectedValue(new Error('snapshot read timed out'));

    await expect(runSweep(WS, { trigger: 'MANUAL', force: true }))
      .rejects.toMatchObject({ source: 'IMPACT_PRIORITY' });

    // ONE attempt. The old shape would have had each of the four consumers try
    // again on its own and fail again — four reads, four errors, one outage.
    expect(getCanonicalVerdictCampaigns).toHaveBeenCalledTimes(1);
    // No verdict written, and no verdict SUPERSEDED: a failed evaluation must not
    // be read as "nothing is eligible any more", which would clear the agenda.
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
    // No reasoning and no narration written from an account nobody could judge.
    expect(prisma.campaignReasoning.upsert).not.toHaveBeenCalled();
    expect(prisma.loopRun.update).not.toHaveBeenCalled();
    // A complete LoopRun audit cannot be written from an unavailable required
    // priority input. No zero-count or quiet-loop result is persisted.
    expect(prisma.loopRun.create).not.toHaveBeenCalled();
  });

  // CONTROL 5/6 (evidence widening / population switching). Whatever the engine
  // was given, every consumer in the sweep must have been given the same thing.
  it('every consumer sees the SAME evidence read — nobody widens or re-scopes it', async () => {
    await runSweep(WS, { trigger: 'MANUAL', force: true });
    expect(getCanonicalVerdictCampaigns.mock.calls).toEqual([[WS]]);
  });
});
