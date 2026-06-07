// ============================================================
// TestTrackerService — loop closure: governance + honesty
// ============================================================
// Proves the Testing OS closes the loop into the existing substrate:
//   1. A confident concluded test emits a PROPOSED verdict Decision
//      whose ActionType validates through the Meta confirm→execute guard.
//   2. EVERY concluded test writes a first-class DecisionMemoryEntry.
//   3. A thin-sample test writes memory but emits NO verdict (honesty).
//   4. The verdict is reconciled to what is governance-valid at the
//      test's entity level.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../lib/prisma.js', () => {
  const prisma = {
    testExperiment:      { findUnique: vi.fn(), update: vi.fn() },
    testVariant:         { update: vi.fn() },
    decision:            { create: vi.fn() },
    decisionMemoryEntry: { create: vi.fn() },
    integration:         { findUnique: vi.fn() },
    $transaction:        vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg) =>
    (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  return { prisma };
});

import { prisma } from '../../lib/prisma.js';
import { concludeTest, resolveVerdict, parseVariantInsights } from './TestTrackerService.js';
import { verdictToActionType }  from '../verdict-engine/verdictTypes.js';
import { validateActionTarget } from '../metaExecutionService.js';

function testRow({ metric = 'CTR', dimension = 'HOOK', entityLevel = 'ADSET', variants }) {
  return {
    id: 'test-1', workspaceId: 'ws-1', entityId: 'ent-1', entityLevel,
    dimension, metric, currency: 'USD', variants,
  };
}
const variant = (id, label, isControl, impressions, clicks) => ({
  id, label, isControl, impressions, clicks, conversions: 0, spendMinor: 0, revenueMinor: 0, metaEntityId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.integration.findUnique.mockResolvedValue(null);       // no live Meta — use stored counts
  prisma.decision.create.mockResolvedValue({ id: 'dec-1' });
  prisma.decisionMemoryEntry.create.mockResolvedValue({ id: 'mem-1' });
  prisma.testExperiment.update.mockResolvedValue({});
  prisma.testVariant.update.mockResolvedValue({});
  prisma.$transaction.mockImplementation(async (arg) =>
    (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
});

describe('concludeTest — confident winner closes the loop with a valid verdict', () => {
  it('emits a PROPOSED Decision that validates through the Meta guard + writes memory', async () => {
    const row = testRow({
      variants: [variant('v-a', 'Hook A', true, 50000, 800), variant('v-b', 'Hook B', false, 50000, 1050)],
    });
    prisma.testExperiment.findUnique.mockResolvedValue(row);

    const out = await concludeTest('test-1');

    // Winner + verdict
    expect(out.readout.winnerLabel).toBe('Hook B');
    expect(out.verdict).toBe('SCALE'); // 31% lift ≥ scale threshold
    // The emitted Decision rides existing governance
    const decisionData = prisma.decision.create.mock.calls[0][0].data;
    expect(decisionData.status).toBe('PROPOSED');
    expect(decisionData.rootCause).toBe('test:test-1');
    const actionType = verdictToActionType(decisionData.verdict, decisionData.entityLevel);
    expect(validateActionTarget(actionType, 'adset')).toBe(true);
    // Memory always written, linked to the decision
    expect(prisma.decisionMemoryEntry.create).toHaveBeenCalledTimes(1);
    const memData = prisma.decisionMemoryEntry.create.mock.calls[0][0].data;
    expect(memData.actionType).toBe('test:HOOK');
    expect(memData.decisionId).toBe('dec-1');
    expect(memData.isSustainable).toBe(true);
    // Test marked concluded; winner flagged
    expect(prisma.testExperiment.update.mock.calls[0][0].data.status).toBe('CONCLUDED');
    expect(prisma.testVariant.update).toHaveBeenCalledWith({ where: { id: 'v-b' }, data: { isWinner: true } });
  });
});

describe('concludeTest — honesty: thin sample writes memory but NO verdict', () => {
  it('records the outcome without emitting a Decision', async () => {
    const row = testRow({
      variants: [variant('v-a', 'A', true, 180, 3), variant('v-b', 'B', false, 180, 4)],
    });
    prisma.testExperiment.findUnique.mockResolvedValue(row);

    const out = await concludeTest('test-1');

    expect(out.readout.confidenceLabel).toBe('INCONCLUSIVE');
    expect(out.verdict).toBeNull();
    expect(out.decisionId).toBeNull();
    expect(prisma.decision.create).not.toHaveBeenCalled();
    // Memory is still written — every concluded test feeds Phase 5.
    expect(prisma.decisionMemoryEntry.create).toHaveBeenCalledTimes(1);
    expect(prisma.decisionMemoryEntry.create.mock.calls[0][0].data.isSustainable).toBeNull();
  });
});

describe('resolveVerdict — reconciles verdict to a governance-valid action per level', () => {
  it('keeps REFRESH at adset (REFRESH_CREATIVE valid there)', () => {
    expect(resolveVerdict('REFRESH', 'ADSET')).toEqual({ verdict: 'REFRESH', actionType: 'REFRESH_CREATIVE' });
  });
  it('falls back REFRESH→SCALE at campaign (REFRESH_CREATIVE invalid there)', () => {
    expect(resolveVerdict('REFRESH', 'CAMPAIGN')).toEqual({ verdict: 'SCALE', actionType: 'SCALE_CAMPAIGN' });
  });
  it('falls back SCALE→REFRESH at ad (INCREASE_BUDGET invalid at ad)', () => {
    expect(resolveVerdict('SCALE', 'AD')).toEqual({ verdict: 'REFRESH', actionType: 'REFRESH_CREATIVE' });
  });
  it('returns null when no valid action fits the level', () => {
    expect(resolveVerdict('SCALE', 'CREATIVE')).toEqual({ verdict: null, actionType: null });
    expect(resolveVerdict(null, 'ADSET')).toEqual({ verdict: null, actionType: null });
  });
});

describe('parseVariantInsights — Meta decimal → minor units', () => {
  it('converts spend and ROAS-derived revenue to minor units', () => {
    const out = parseVariantInsights(
      { impressions: '1000', clicks: '30', spend: '50.00', conversions: '5',
        purchase_roas: [{ action_type: 'omni_purchase', value: '2.5' }] },
      'USD',
    );
    expect(out).toEqual({ impressions: 1000, clicks: 30, conversions: 5, spendMinor: 5000, revenueMinor: 12500 });
  });
});
