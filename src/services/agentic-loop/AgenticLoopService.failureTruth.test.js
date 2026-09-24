import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decision: { findMany: vi.fn() },
    fatiguePrediction: { findMany: vi.fn() },
    testExperiment: { findMany: vi.fn() },
    incrementalityTest: { findMany: vi.fn() },
    plan: { findMany: vi.fn() },
    allocationPlan: { findMany: vi.fn() },
    outcomeSnapshot: { findMany: vi.fn() },
    decisionMemoryEntry: { findMany: vi.fn() },
    account: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    adSet: { findMany: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../entity-graph/index.js', () => ({ getConnectorCampaigns: vi.fn() }));
vi.mock('../verdict-engine/index.js', () => ({
  getConnectorVerdicts: vi.fn(), evaluateConnectorVerdicts: vi.fn(), failedEvaluation: vi.fn(),
}));
vi.mock('../portfolio/PortfolioService.js', () => ({ getPortfolio: vi.fn() }));
vi.mock('../blended-truth/BlendedTruthService.js', () => ({ getBlendedTruth: vi.fn() }));
vi.mock('../test-generator/TestGeneratorService.js', () => ({ getWeeklyAgenda: vi.fn() }));
vi.mock('../planning/PlanService.js', () => ({ trackPlan: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { getConnectorCampaigns } from '../entity-graph/index.js';
import { getConnectorVerdicts } from '../verdict-engine/index.js';
import { getPortfolio } from '../portfolio/PortfolioService.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { getWeeklyAgenda } from '../test-generator/TestGeneratorService.js';
import { trackPlan } from '../planning/PlanService.js';
import { buildLoopInputs } from './AgenticLoopService.js';
import { planAgenda } from './agenticPlanner.js';

const workspaceId = 'ws1';
const now = new Date('2026-09-24T12:00:00.000Z');
const failure = new Error('private database details');

beforeEach(() => {
  vi.resetAllMocks();
  prisma.decision.findMany.mockResolvedValue([]);
  for (const model of [
    'fatiguePrediction', 'testExperiment', 'incrementalityTest', 'plan',
    'allocationPlan', 'outcomeSnapshot', 'decisionMemoryEntry',
    'account', 'campaign', 'adSet',
  ]) prisma[model].findMany.mockResolvedValue([]);
  prisma.workspace.findUnique.mockResolvedValue({ objective: null });
  getConnectorCampaigns.mockResolvedValue([]);
  getConnectorVerdicts.mockResolvedValue({ verdicts: [] });
  getPortfolio.mockResolvedValue(null);
  getBlendedTruth.mockResolvedValue(null);
  getWeeklyAgenda.mockResolvedValue([]);
  trackPlan.mockResolvedValue({ goals: [] });
});

describe('buildLoopInputs requires successful evidence before planning', () => {
  it('uses a populated decision read without changing the item', async () => {
    const decision = { id: 'd1', entityId: 'c1', verdict: 'KILL', status: 'PROPOSED', diagnosis: 'Review' };
    prisma.decision.findMany.mockResolvedValueOnce([decision]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const inputs = await buildLoopInputs(workspaceId, { now });
    expect(inputs.verdicts).toEqual([decision]);
    expect(planAgenda(inputs).buyerBand).toEqual([expect.objectContaining({ evidenceRef: 'd1' })]);
  });

  it('accepts genuine empty reads and can produce a quiet agenda', async () => {
    const inputs = await buildLoopInputs(workspaceId, { now });
    expect(inputs.verdicts).toEqual([]);
    expect(inputs.recentOutcomes).toEqual([]);
    expect(inputs.recentMemory).toEqual([]);
    expect(planAgenda(inputs).summary).toMatch(/quiet/);
  });

  it.each([
    ['FATIGUE', () => prisma.fatiguePrediction.findMany.mockResolvedValue([{ id: 'f1' }]), (i) => i.fatiguePredictions],
    ['EXPERIMENTS', () => prisma.testExperiment.findMany.mockResolvedValue([{ id: 't1' }]), (i) => i.openTests],
    ['HOLDOUTS', () => prisma.incrementalityTest.findMany.mockResolvedValue([{ id: 'h1' }]), (i) => i.openHoldouts],
    ['PLANS', () => prisma.plan.findMany.mockResolvedValue([{ id: 'p1', status: 'CLOSED' }]), (i) => i.plans],
    ['ALLOCATIONS', () => prisma.allocationPlan.findMany.mockResolvedValue([{ id: 'a1' }]), (i) => i.allocationPlans],
    ['EXECUTIONS', () => prisma.decision.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'e1' }]), (i) => i.platformExecutions],
    ['OUTCOMES', () => prisma.outcomeSnapshot.findMany.mockResolvedValue([{ id: 'o1' }]), (i) => i.recentOutcomes],
    ['MEMORY', () => prisma.decisionMemoryEntry.findMany.mockResolvedValue([{ id: 'm1' }]), (i) => i.recentMemory],
    ['TEST_AGENDA', () => getWeeklyAgenda.mockResolvedValue([{ id: 'ta1' }]), (i) => i.testAgenda],
  ])('%s populated success remains available to the planner', async (_source, populate, read) => {
    populate();
    const inputs = await buildLoopInputs(workspaceId, { now });
    expect(read(inputs)).toHaveLength(1);
  });

  it('successful portfolio pacing, blended truth, objective, and plan tracking retain their values', async () => {
    getPortfolio.mockResolvedValue({ pacing: { status: 'OVER', daysEarly: 2 }, channels: [] });
    getBlendedTruth.mockResolvedValue({ portfolio: { gapPct: 25 } });
    prisma.workspace.findUnique.mockResolvedValue({ objective: 'roas' });
    prisma.plan.findMany.mockResolvedValue([{ id: 'p1', status: 'ACTIVE' }]);
    trackPlan.mockResolvedValue({ goals: [{ goalId: 'g1' }] });
    const inputs = await buildLoopInputs(workspaceId, { now });
    expect(inputs.pacing).toEqual([expect.objectContaining({ status: 'OVER', daysEarly: 2 })]);
    expect(getPortfolio).toHaveBeenCalledWith(workspaceId, { strictBudgetRead: true });
    expect(inputs.blended.portfolio.gapPct).toBe(25);
    expect(inputs.objective).toBe('roas');
    expect(inputs.planTracking.goals).toEqual([{ goalId: 'g1' }]);
  });

  it.each([
    ['SIGNAL_DECISIONS', () => prisma.decision.findMany.mockRejectedValueOnce(failure)],
    ['GUARDRAIL_DECISIONS', () => prisma.decision.findMany.mockResolvedValueOnce([]).mockRejectedValueOnce(failure)],
    ['FATIGUE', () => prisma.fatiguePrediction.findMany.mockRejectedValue(failure)],
    ['EXPERIMENTS', () => prisma.testExperiment.findMany.mockRejectedValue(failure)],
    ['HOLDOUTS', () => prisma.incrementalityTest.findMany.mockRejectedValue(failure)],
    ['PLANS', () => prisma.plan.findMany.mockRejectedValue(failure)],
    ['ALLOCATIONS', () => prisma.allocationPlan.findMany.mockRejectedValue(failure)],
    ['EXECUTIONS', () => prisma.decision.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(failure)],
    ['OUTCOMES', () => prisma.outcomeSnapshot.findMany.mockRejectedValue(failure)],
    ['MEMORY', () => prisma.decisionMemoryEntry.findMany.mockRejectedValue(failure)],
    ['PORTFOLIO_PACING', () => getPortfolio.mockRejectedValue(failure)],
    ['BLENDED_TRUTH', () => getBlendedTruth.mockRejectedValue(failure)],
    ['TEST_AGENDA', () => getWeeklyAgenda.mockRejectedValue(failure)],
    ['OBJECTIVE', () => prisma.workspace.findUnique.mockRejectedValue(failure)],
    ['IMPACT_PRIORITY', () => getConnectorCampaigns.mockRejectedValue(failure)],
    ['PLAN_TRACKING', () => { prisma.plan.findMany.mockResolvedValue([{ id: 'p1', status: 'ACTIVE' }]); trackPlan.mockRejectedValue(failure); }],
  ])('%s failure rejects rather than furnishing a planner fallback', async (source, fail) => {
    fail();
    await expect(buildLoopInputs(workspaceId, { now })).rejects.toMatchObject({ source, cause: failure });
  });

  it('retains a logged fallback only for decorative entity labels', async () => {
    prisma.account.findMany.mockRejectedValue(failure);
    const inputs = await buildLoopInputs(workspaceId, { now });
    expect(inputs.labelsById).toEqual(new Map());
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ENTITY_LABELS', workspaceId }),
      '[AgenticLoop] entity labels unavailable',
    );
  });
});
