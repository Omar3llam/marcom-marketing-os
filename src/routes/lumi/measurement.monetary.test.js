import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    incrementalityTest: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/unit-economics/EconomicsService.js', () => ({ getEconomics: vi.fn() }));
vi.mock('../../services/attribution-engine/AttributionService.js', () => ({ getAttribution: vi.fn() }));
vi.mock('../../services/reconciliation/ReconciliationService.js', () => ({ getReconciliation: vi.fn() }));
vi.mock('../../middleware/requirePlan.js', () => ({ requirePlan: () => (_req, _res, next) => next() }));
vi.mock('../../middleware/requireMeasurementTier.js', () => ({
  requireMeasurementTier: (req, _res, next) => { req.measurementWorkspaceId = 'ws'; next(); },
}));
vi.mock('../../middleware/requireCollabRole.js', () => ({ requireCollabRole: () => (_req, _res, next) => next() }));

import { prisma } from '../../lib/prisma.js';
import { getEconomics } from '../../services/unit-economics/EconomicsService.js';
import { measurementRouter } from './measurement.js';
import { listTests, getTest } from '../../services/incrementality-engine/IncrementalityService.js';
import { projectIncrementalityTest } from '../../services/incrementality-engine/incrementalityProjection.js';
import { buildNarrativeInputs } from '../../services/narrative-engine/NarrativeService.js';

const money = {
  status: 'INSUFFICIENT_EVIDENCE', reason: 'INCREMENTALITY_MONETARY_BASIS_UNPROVEN',
  knowledge: 'NOT_ENOUGH', incrementalRevenueMinor: null, currency: null,
};
const historical = Object.freeze({
  id: 'h1', workspaceId: 'ws', name: 'Meta holdout', channel: 'META',
  entityId: 'e1', entityLevel: 'CAMPAIGN', status: 'CONCLUDED',
  holdoutPct: 0.1, mde: 0.1, sampleSizePerArm: 5000, durationDays: 14,
  exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250,
  liftPct: 20, ciLow: 0.001, ciHigh: 0.018, confidenceLabel: 'MEDIUM',
  incrementalRevenueMinor: 250000, decisionId: 'd1',
  sourceTest: { id: 't1', dimension: 'HOOK', hypothesis: 'B increases conversion' },
});
const app = express();
app.use(express.json());
app.use(measurementRouter);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.incrementalityTest.findMany.mockResolvedValue([historical]);
  prisma.incrementalityTest.findFirst.mockResolvedValue(historical);
  getEconomics.mockResolvedValue({ economics: { currency: 'EGP', aovMinor: 5000 } });
});

describe('SC-10 — real service projections at the public route boundary', () => {
  it('list and detail withhold historical money identically and preserve all causal/provenance fields', async () => {
    const list = await request(app).get('/incrementality');
    const detail = await request(app).get('/incrementality/h1');
    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(list.body.tests[0]).toEqual(detail.body.test);
    expect(detail.body.test).toEqual({ ...historical, incrementalRevenueMinor: null, monetary: money });
    expect(historical.incrementalRevenueMinor).toBe(250000);
    expect(prisma.incrementalityTest.create).not.toHaveBeenCalled();
    expect(prisma.incrementalityTest.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(getEconomics).not.toHaveBeenCalled();
  });

  it('projection cannot grant authority from current or injected currency/valuation labels', () => {
    for (const currency of ['EGP', 'USD', 'SAR', null]) {
      const projected = projectIncrementalityTest({
        ...historical, currency, aovMinor: 9999,
        monetary: { status: 'AVAILABLE', currency, incrementalRevenueMinor: 250000 },
      });
      expect(projected.incrementalRevenueMinor).toBeNull();
      expect(projected.monetary).toEqual(money);
    }
  });

  it('missing detail stays missing and a failed read stays failed', async () => {
    prisma.incrementalityTest.findFirst.mockResolvedValue(null);
    expect(await getTest('ws', 'missing')).toBeNull();
    prisma.incrementalityTest.findMany.mockRejectedValue(new Error('database unavailable'));
    await expect(listTests('ws')).rejects.toThrow('database unavailable');
  });

  it('design and counts mutation responses use the same safe row contract', async () => {
    prisma.incrementalityTest.create.mockResolvedValue({ ...historical, status: 'DESIGNED' });
    const design = await request(app).post('/incrementality')
      .send({ channel: 'META', baselineCvr: 0.02, mde: 0.1, dailyEligible: 5000 });
    expect(design.status).toBe(201);
    expect(design.body.test.monetary).toEqual(money);
    expect(design.body.test.incrementalRevenueMinor).toBeNull();
    prisma.incrementalityTest.findFirst.mockResolvedValue({ ...historical, status: 'RUNNING' });
    prisma.incrementalityTest.updateMany.mockResolvedValue({ count: 1 });
    const counts = await request(app).post('/incrementality/h1/metrics')
      .send({ exposedUsers: 5000, exposedConversions: 300, holdoutUsers: 5000, holdoutConversions: 250 });
    expect(counts.status).toBe(200);
    expect(counts.body.test.monetary).toEqual(money);
    expect(counts.body.test.incrementalRevenueMinor).toBeNull();
    expect(counts.body.test.exposedConversions).toBe(300);
  });

  it('conclude preserves legacy persistence but publishes no stronger money; memory/narrative remain causal', async () => {
    const tx = {
      decision: { create: vi.fn().mockResolvedValue({ id: 'd1' }) },
      incrementalityTest: { update: vi.fn().mockResolvedValue({}) },
      decisionMemoryEntry: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    const response = await request(app).post('/incrementality/h1/conclude');
    expect(response.status).toBe(201);
    expect(response.body.readout).toMatchObject({
      conclusive: true, liftPct: 20, confidenceLabel: 'MEDIUM', monetary: money,
      incrementalConversions: { value: 50 },
      incrementalRevenueMinor: { value: null, source: 'UNAVAILABLE', confidence: 'UNKNOWN',
        reason: money.reason, status: 'UNAVAILABLE' },
    });
    expect(response.body.readout.ci).toHaveLength(2);
    expect(response.body).toMatchObject({ decisionId: 'd1', memoryId: 'm1' });
    expect(tx.incrementalityTest.update.mock.calls[0][0].data.incrementalRevenueMinor).toBe(250000);
    expect(tx.incrementalityTest.update.mock.calls[0][0].data).not.toHaveProperty('currency');
    const memory = tx.decisionMemoryEntry.create.mock.calls[0][0].data;
    expect(memory.rationale).toContain('+20% incremental');
    expect(memory).not.toHaveProperty('incrementalRevenueMinor');
    expect(memory.rationale).not.toMatch(/250000|EGP|USD|revenue/i);
    const narrative = buildNarrativeInputs({ concludedTests: [historical] });
    expect(narrative.incrementality).toEqual([{
      testId: 'h1', channel: 'META', liftPct: 20,
      ciLow: 0.001, ciHigh: 0.018, ciExcludesZero: true,
    }]);
  });
});
