import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: {
  fatiguePrediction: { findMany: vi.fn(async () => []) },
  decision: { findMany: vi.fn(async () => []) },
  allocationPlan: { findMany: vi.fn(async () => []) },
  testExperiment: { findMany: vi.fn(async () => []) },
  accountPattern: { findMany: vi.fn(async () => []) },
  plan: { findFirst: vi.fn() },
  workspace: { findUnique: vi.fn(async () => null) },
} }));
vi.mock('../../services/portfolio/PortfolioService.js', () => ({ getPortfolio: vi.fn(async () => null) }));
vi.mock('../../services/test-generator/TestGeneratorService.js', () => ({ getWeeklyAgenda: vi.fn(async () => []) }));
vi.mock('../../services/planning/PlanService.js', () => ({ evaluateGoalTracking: vi.fn() }));
vi.mock('./feedSurfacing.js', () => ({ surfaceCollaboration: vi.fn(async () => null) }));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../lib/prisma.js';
import { evaluateGoalTracking } from '../../services/planning/PlanService.js';
import { feedRouter } from './feed.js';

const app = express();
app.use((req, _res, next) => { req.workspaceId = 'ws-1'; next(); });
app.use('/', feedRouter);

describe('feed planning evidence', () => {
  it('publishes semantic storage and keeps legacy MER-named columns classified as legacy', async () => {
    prisma.plan.findFirst.mockResolvedValueOnce(null);
    prisma.allocationPlan.findMany.mockResolvedValueOnce([
      { id: 'new', goalType: 'GROWTH_CEILING', totalBudgetMinor: 100000, currency: 'USD',
        blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.4,
        merBefore: null, merAfter: null, projectedCpaMinor: null, status: 'PROPOSED' },
      { id: 'legacy', goalType: 'GROWTH_CEILING', totalBudgetMinor: 100000, currency: 'USD',
        blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null,
        merBefore: 9, merAfter: 10, projectedCpaMinor: null, status: 'PROPOSED' },
    ]);
    const response = await request(app).get('/feed').expect(200);
    expect(response.body.allocationPlans).toMatchObject([
      { id: 'new', efficiencyStatus: 'BLENDED_REVENUE_EFFICIENCY',
        blendedRevenueEfficiencyBefore: 2, blendedRevenueEfficiencyAfter: 2.4 },
      { id: 'legacy', efficiencyStatus: 'LEGACY_PROJECTED_EFFICIENCY',
        blendedRevenueEfficiencyBefore: null, blendedRevenueEfficiencyAfter: null },
    ]);
    expect(JSON.stringify(response.body.allocationPlans)).not.toMatch(/"merBefore"|"merAfter"/);
  });

  it('does not publish a legacy positive status or stored numeric landing when MER is unmeasured', async () => {
    const goal = { id: 'goal-1', metric: 'mer', comparator: 'GTE', targetValue: 3, status: 'ON_TRACK' };
    prisma.plan.findFirst.mockResolvedValue({
      id: 'plan-1', name: 'Legacy plan', status: 'ACTIVE', totalBudgetMinor: 100000,
      currency: 'EGP', memoryBasis: [], goals: [goal],
      projections: { goalLanding: { trendBasedLandingEstimate: { low: 3, expected: 4, high: 5 } } },
    });
    evaluateGoalTracking.mockResolvedValue({ status: 'INSUFFICIENT_EVIDENCE',
      reason: 'BUSINESS_REVENUE_SOURCE_UNAVAILABLE', currency: null, landing: null });

    const response = await request(app).get('/feed').expect(200);
    expect(evaluateGoalTracking).toHaveBeenCalledWith('ws-1', goal);
    expect(response.body.planning.goal).toMatchObject({
      id: 'goal-1', status: 'INSUFFICIENT_EVIDENCE',
      unavailableReason: 'BUSINESS_REVENUE_SOURCE_UNAVAILABLE', currency: null, landing: null,
    });
    expect(JSON.stringify(response.body.planning)).not.toContain('"expected":4');
  });
});
