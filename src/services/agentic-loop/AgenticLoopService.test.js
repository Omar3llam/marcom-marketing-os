// ============================================================
// AgenticLoopService.buildLoopInputs — the connector-verdict wiring
// ------------------------------------------------------------
// The Phase-9 fix: the buyer band's verdict query must load BOTH guardrail
// hits AND connector verdicts (revenue + awareness), de-duped to the latest
// per entity, and stay workspace-scoped. Only the DB + the pacing/blended/
// test/plan read-services are mocked; the query shape is asserted directly.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
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
  },
}));
vi.mock('../portfolio/PortfolioService.js',       () => ({ getPortfolio: vi.fn() }));
vi.mock('../test-generator/TestGeneratorService.js', () => ({ getWeeklyAgenda: vi.fn() }));
vi.mock('../planning/PlanService.js',             () => ({ trackPlan: vi.fn() }));
vi.mock('../blended-truth/BlendedTruthService.js', () => ({ getBlendedTruth: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { getPortfolio } from '../portfolio/PortfolioService.js';
import { getWeeklyAgenda } from '../test-generator/TestGeneratorService.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { SIGNAL_TYPE } from '../diagnosis-engine/index.js';
import { buildLoopInputs } from './AgenticLoopService.js';
import { planAgenda } from './agenticPlanner.js';

const WS  = '7517d1b9-b967-44f3-a77f-60f5c577f867';
const now = new Date('2026-07-02T00:00:00.000Z');

// A connector verdict as VerdictService persists it: rootCause = the diagnosis
// signalType (NOT a `guardrail:` prefix), status PROPOSED.
const connectorVerdict = {
  id: 'cv1', entityId: 'c1d2e3f4-0000-0000-0000-000000000010', entityLevel: 'CAMPAIGN',
  verdict: 'REFRESH', rationale: 'Creative fatigue detected', rootCause: SIGNAL_TYPE.CREATIVE_FATIGUE, status: 'PROPOSED',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Every organ cold by default; the verdict query is overridden per-test.
  for (const model of ['fatiguePrediction', 'testExperiment', 'plan', 'allocationPlan',
    'action', 'outcomeSnapshot', 'decisionMemoryEntry', 'account', 'campaign', 'adSet']) {
    prisma[model].findMany.mockResolvedValue([]);
  }
  prisma.decision.findMany.mockResolvedValue([]);
  getPortfolio.mockResolvedValue(null);
  getBlendedTruth.mockResolvedValue(null);
  getWeeklyAgenda.mockResolvedValue([]);
});

describe('buildLoopInputs — verdict query wiring', () => {
  it('loads connector verdicts (signalType rootCause), not only guardrail hits', async () => {
    prisma.decision.findMany.mockResolvedValue([connectorVerdict]);
    const inputs = await buildLoopInputs(WS, { now });
    expect(inputs.verdicts).toEqual([connectorVerdict]);
  });

  it('widens the query to guardrail + connector verdicts, workspace-scoped, latest-per-entity', async () => {
    await buildLoopInputs(WS, { now });
    const args = prisma.decision.findMany.mock.calls[0][0];
    expect(args.where.workspaceId).toBe(WS);
    expect(args.where.status).toBe('PROPOSED');
    expect(args.distinct).toEqual(['entityId', 'entityLevel']);

    // The OR must cover BOTH families — guardrail prefix AND the connector signalTypes.
    const hasGuardrail = args.where.OR.some((c) => c.rootCause?.startsWith === 'guardrail:');
    const hasConnector = args.where.OR.some((c) => Array.isArray(c.rootCause?.in)
      && Object.values(SIGNAL_TYPE).every((t) => c.rootCause.in.includes(t)));
    expect(hasGuardrail).toBe(true);
    expect(hasConnector).toBe(true);
  });

  it('a connector verdict flows through the planner into a buyer CONFIRM item', async () => {
    prisma.decision.findMany.mockResolvedValue([connectorVerdict]);
    const inputs = await buildLoopInputs(WS, { now });
    const agenda = planAgenda(inputs);
    const item = agenda.buyerBand.find((i) => i.evidenceRef === 'cv1');
    expect(item).toBeTruthy();
    expect(item.type).toBe('VERDICT');
    expect(item.entityId).toBe(connectorVerdict.entityId);
  });

  it('empty connector data → empty verdicts → the planner reports a quiet loop', async () => {
    const inputs = await buildLoopInputs(WS, { now });
    expect(inputs.verdicts).toEqual([]);
    expect(planAgenda(inputs).buyerBand).toEqual([]);
    expect(planAgenda(inputs).summary).toMatch(/quiet/i);
  });
});
