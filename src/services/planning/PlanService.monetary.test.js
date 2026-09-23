import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => {
  const tx = {
    plan: { create: vi.fn() },
    northStarGoal: { create: vi.fn() },
    allocationPlan: { create: vi.fn() },
    decision: { createMany: vi.fn() },
  };
  return { prisma: {
    ...tx,
    plan: { ...tx.plan, findFirst: vi.fn() },
    $transaction: vi.fn((fn) => fn(tx)),
  } };
});
vi.mock('../allocation-engine/AllocationService.js', () => ({ previewAllocation: vi.fn(), persistAllocation: vi.fn() }));
vi.mock('../test-generator/TestGeneratorService.js', () => ({ getWeeklyAgenda: vi.fn(async () => []) }));
vi.mock('../scenario-engine/ScenarioService.js', () => ({ runScenario: vi.fn(), gatherLeadingSignals: vi.fn() }));
vi.mock('../unit-economics/EconomicsService.js', () => ({ assessSustainability: vi.fn() }));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots: vi.fn(async () => []) }));
vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '../../lib/prisma.js';
import { previewAllocation } from '../allocation-engine/AllocationService.js';
import { runScenario } from '../scenario-engine/ScenarioService.js';
import { buildPlan } from './PlanService.js';

const goal = { metric: 'blendedCac', comparator: 'LTE', targetValue: 1000 };
const input = (currency, extra = {}) => ({
  name: 'Monetary plan', periodStart: '2026-09-01', periodEnd: '2026-09-30',
  totalBudgetMinor: 100000, totalBudgetCurrency: currency, goal, ...extra,
});
const validMix = (currency) => ({
  monetaryStatus: 'MONETARY_VALID', monetaryReason: null, currency,
  spendPeriod: { status: 'MEASURABLE', currency },
  totalBudgetMinor: 100000, goal: { type: 'GROWTH_CEILING' },
  allocations: [], projected: { projectedCpaMinor: null }, reasoningTrail: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.plan.create.mockImplementation(async ({ data }) => ({ id: 'plan-1', ...data }));
  prisma.plan.findFirst.mockImplementation(async () => ({
    id: 'plan-1', goals: [], approvals: [],
  }));
  prisma.northStarGoal.create.mockResolvedValue({ id: 'goal-1' });
});

describe('Plan monetary persistence boundary', () => {
  it.each(['EGP', 'USD', 'SAR'])('forwards explicit %s and persists Plan/Goal in one transaction', async (currency) => {
    previewAllocation.mockResolvedValue(validMix(currency));
    await buildPlan('ws-1', input(currency));
    expect(previewAllocation).toHaveBeenCalledWith('ws-1', expect.objectContaining({ totalBudgetCurrency: currency }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.plan.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currency }) }));
    expect(prisma.northStarGoal.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currency, planId: 'plan-1' }) }));
  });

  it.each([
    [undefined, 'BUDGET_CURRENCY_MISSING'],
    ['XYZ', 'BUDGET_CURRENCY_INVALID'],
    ['USD', 'BUDGET_CURRENCY_MISMATCH'],
    ['EGP', 'SPEND_CURRENCY_MIXED'],
    ['EGP', 'SPEND_CURRENCY_UNTRUSTED'],
  ])('refuses %s / %s before any monetary write', async (currency, reason) => {
    previewAllocation.mockResolvedValue({
      monetaryStatus: reason === 'SPEND_CURRENCY_MIXED' ? 'MONETARY_UNAVAILABLE_MIXED' : 'MONETARY_UNAVAILABLE_UNTRUSTED',
      monetaryReason: reason, currency: null, allocations: [],
    });
    await expect(buildPlan('ws-1', input(currency)))
      .rejects.toMatchObject({ code: 'PlanMonetaryUnavailable', reason });
    expect(previewAllocation).toHaveBeenCalledWith('ws-1', expect.objectContaining({ totalBudgetCurrency: currency }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.plan.create).not.toHaveBeenCalled();
    expect(prisma.northStarGoal.create).not.toHaveBeenCalled();
    expect(prisma.allocationPlan.create).not.toHaveBeenCalled();
    expect(prisma.decision.createMany).not.toHaveBeenCalled();
  });

  it('does not let a scenario denomination repair unavailable allocation', async () => {
    previewAllocation.mockResolvedValue({
      monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED',
      monetaryReason: 'BUDGET_CURRENCY_MISSING', currency: null,
    });
    runScenario.mockResolvedValue({ currency: 'USD', projections: {} });
    await expect(buildPlan('ws-1', input(undefined, { change: { type: 'BUDGET_EXPANSION' } })))
      .rejects.toMatchObject({ code: 'PlanMonetaryUnavailable', reason: 'BUDGET_CURRENCY_MISSING' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps Plan and Goal creation in the same transaction callback if Goal creation fails', async () => {
    previewAllocation.mockResolvedValue(validMix('SAR'));
    prisma.northStarGoal.create.mockRejectedValue(new Error('goal insert failed'));
    await expect(buildPlan('ws-1', input('SAR'))).rejects.toThrow('goal insert failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.plan.create).toHaveBeenCalledTimes(1);
    expect(prisma.northStarGoal.create).toHaveBeenCalledTimes(1);
  });
});
