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
vi.mock('../connectors/credentialStore.js', () => ({ resolveCredential: vi.fn() }));
vi.mock('../../lib/prisma.js', () => {
  const prisma = {
    testExperiment:      { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    testVariant:         { update: vi.fn() },
    decision:            { create: vi.fn() },
    decisionMemoryEntry: { create: vi.fn() },
    $transaction:        vi.fn(),
    $queryRaw:           vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg) =>
    (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  return { prisma };
});

import { prisma } from '../../lib/prisma.js';
import axios from 'axios';
import { resolveCredential } from '../connectors/credentialStore.js';
import { concludeTest, startTest, recordVariantMetrics, refreshFromMeta, resolveVerdict, parseVariantInsights } from './TestTrackerService.js';
import { verdictToActionType }  from '../verdict-engine/verdictTypes.js';
import { validateActionTarget } from '../metaExecutionService.js';
import { buildMemoryInputs } from '../test-generator/TestGeneratorService.js';
import { generateAgenda } from '../test-generator/testGeneratorEngine.js';

function testRow({ metric = 'CTR', dimension = 'HOOK', entityLevel = 'ADSET', variants }) {
  return {
    id: 'test-1', workspaceId: 'ws-1', entityId: 'ent-1', entityLevel, status: 'RUNNING',
    dimension, metric, currency: 'USD', variants,
  };
}
const variant = (id, label, isControl, impressions, clicks) => ({
  id, label, isControl, impressions, clicks, conversions: 0, spendMinor: 0, revenueMinor: 0, metaEntityId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveCredential.mockResolvedValue(null);                   // no live Meta — use stored counts
  prisma.decision.create.mockResolvedValue({ id: 'dec-1' });
  prisma.decisionMemoryEntry.create.mockResolvedValue({ id: 'mem-1' });
  prisma.testExperiment.update.mockResolvedValue({});
  prisma.testVariant.update.mockResolvedValue({});
  prisma.$queryRaw.mockResolvedValue([{ id: 'test-1' }]);
  prisma.$transaction.mockImplementation(async (arg) =>
    (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
});

describe('concludeTest — confident winner closes the loop with a valid verdict', () => {
  it('emits a PROPOSED Decision that validates through the Meta guard + writes memory', async () => {
    const row = testRow({
      variants: [variant('v-a', 'Hook A', true, 50000, 800), variant('v-b', 'Hook B', false, 50000, 1050)],
    });
    prisma.testExperiment.findFirst.mockResolvedValue(row);

    const out = await concludeTest('ws-1', 'test-1');

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
    expect(memData.isSustainable).toBeNull(); // Confidence does not measure durability.
    // Test marked concluded; winner flagged
    expect(prisma.testExperiment.update.mock.calls[0][0].data.status).toBe('CONCLUDED');
    expect(prisma.testVariant.update).toHaveBeenCalledWith({
      where: { id: 'v-b', testId: 'test-1', test: { workspaceId: 'ws-1' } }, data: { isWinner: true },
    });
  });

  it('a confident result with unmeasured durability remains neutral in the next agenda', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(testRow({
      variants: [variant('v-a', 'A', true, 50000, 800), variant('v-b', 'B', false, 50000, 1050)],
    }));
    await concludeTest('ws-1', 'test-1', { refresh: false });
    const written = prisma.decisionMemoryEntry.create.mock.calls[0][0].data;
    const suggestions = generateAgenda({
      entities: [{ entityId: 'ent-1', metrics: { ctr: 0.5, spendMinor: 10000 } }],
      memory: buildMemoryInputs([written]),
    });
    expect(suggestions.find((s) => s.dimension === 'HOOK').rationale).toContain('memory ×1).');
  });
});

describe('concludeTest — honesty: thin sample writes memory but NO verdict', () => {
  it('records the outcome without emitting a Decision', async () => {
    const row = testRow({
      variants: [variant('v-a', 'A', true, 180, 3), variant('v-b', 'B', false, 180, 4)],
    });
    prisma.testExperiment.findFirst.mockResolvedValue(row);

    const out = await concludeTest('ws-1', 'test-1');

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

describe('workspace isolation — the mutation paths refuse a cross-workspace id', () => {
  it('startTest authorizes by {id, workspaceId} then updates', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue({ id: 'test-1', workspaceId: 'ws-1', status: 'PROPOSED' });
    await startTest('ws-1', 'test-1');
    expect(prisma.testExperiment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'test-1', workspaceId: 'ws-1' } }),
    );
    expect(prisma.testExperiment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'test-1', workspaceId: 'ws-1' }, data: expect.objectContaining({ status: 'RUNNING' }) }),
    );
  });

  it('startTest throws (→404) when the id belongs to another workspace', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(null);
    await expect(startTest('ws-1', 'foreign')).rejects.toThrow(/not found/i);
    expect(prisma.testExperiment.update).not.toHaveBeenCalled();
  });

  it('recordVariantMetrics writes only variants owned by the in-workspace test (forged id dropped)', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue({ id: 'test-1', workspaceId: 'ws-1', status: 'RUNNING', variants: [{ id: 'v-a' }, { id: 'v-b' }] });
    const out = await recordVariantMetrics('ws-1', 'test-1', [
      { variantId: 'v-a', clicks: 10 },
      { variantId: 'foreign-variant', clicks: 999 }, // belongs to another workspace's test
    ]);
    expect(out.updated).toBe(1);
    expect(prisma.testVariant.update).toHaveBeenCalledTimes(1);
    expect(prisma.testVariant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'v-a', testId: 'test-1', test: { workspaceId: 'ws-1' } },
    }));
  });

  it('recordVariantMetrics throws (→404) when the id belongs to another workspace', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(null);
    await expect(recordVariantMetrics('ws-1', 'foreign', [{ variantId: 'v-a', clicks: 1 }])).rejects.toThrow(/not found/i);
    expect(prisma.testVariant.update).not.toHaveBeenCalled();
  });

  it('concludeTest throws (→404) when the id belongs to another workspace', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(null);
    await expect(concludeTest('ws-1', 'foreign', { refresh: false })).rejects.toThrow(/not found/i);
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(prisma.decisionMemoryEntry.create).not.toHaveBeenCalled();
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

describe('CP-03A lifecycle integrity', () => {
  const running = () => testRow({ variants: [
    variant('v-a', 'A', true, 50000, 800), variant('v-b', 'B', false, 50000, 1050),
  ] });

  it('a second conclusion refuses before another refresh, Decision or Memory write', async () => {
    const row = running();
    row.variants.forEach((v) => { v.metaEntityId = v.id; });
    prisma.testExperiment.findFirst.mockResolvedValue(row);
    prisma.testExperiment.update.mockImplementation(async ({ data }) => Object.assign(row, data));
    resolveCredential.mockResolvedValue({ accessToken: 'test-only' });
    axios.get.mockResolvedValue({ data: { data: [{ impressions: '50000', clicks: '1050', spend: '0' }] } });
    await concludeTest('ws-1', 'test-1');
    const refreshCalls = axios.get.mock.calls.length;
    await expect(concludeTest('ws-1', 'test-1')).rejects.toMatchObject({ code: 'TEST_CONFLICT' });
    expect(axios.get).toHaveBeenCalledTimes(refreshCalls);
    expect(prisma.decision.create).toHaveBeenCalledTimes(1);
    expect(prisma.decisionMemoryEntry.create).toHaveBeenCalledTimes(1);
  });

  for (const status of ['CONCLUDED', 'ABANDONED']) {
    for (const operation of [startTest, recordVariantMetrics, refreshFromMeta, concludeTest]) {
      it(`${operation.name} refuses ${status} without writes or credential access`, async () => {
        prisma.testExperiment.findFirst.mockResolvedValue({ ...running(), status });
        await expect(operation('ws-1', 'test-1', [{ variantId: 'v-a', clicks: 1 }]))
          .rejects.toMatchObject({ code: 'TEST_CONFLICT' });
        expect(prisma.testExperiment.update).not.toHaveBeenCalled();
        expect(prisma.testVariant.update).not.toHaveBeenCalled();
        expect(resolveCredential).not.toHaveBeenCalled();
      });
    }
  }

  it('a repeated start returns conflict and preserves the original start time', async () => {
    const row = { ...running(), status: 'PROPOSED' };
    prisma.testExperiment.findFirst.mockResolvedValue(row);
    prisma.testExperiment.update.mockImplementation(async ({ data }) => Object.assign(row, data));
    await startTest('ws-1', 'test-1');
    const startedAt = row.startedAt;
    await expect(startTest('ws-1', 'test-1')).rejects.toMatchObject({ code: 'TEST_CONFLICT' });
    expect(row.startedAt).toBe(startedAt);
    expect(prisma.testExperiment.update).toHaveBeenCalledTimes(1);
  });

  for (const field of ['impressions', 'clicks', 'conversions', 'spendMinor', 'revenueMinor']) {
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, 2147483648, '10']) {
      it(`rejects ${field}=${String(value)} before any batch write`, async () => {
        prisma.testExperiment.findFirst.mockResolvedValue(running());
        await expect(recordVariantMetrics('ws-1', 'test-1', [
          { variantId: 'v-a', clicks: 10 }, { variantId: 'v-b', [field]: value },
        ])).rejects.toMatchObject({ code: 'INVALID_TEST_METRICS' });
        expect(prisma.testVariant.update).not.toHaveBeenCalled();
      });
    }
  }

  it('accepts integer endpoints and conversions above clicks without an invented attribution rule', async () => {
    prisma.testExperiment.findFirst.mockResolvedValue(running());
    await expect(recordVariantMetrics('ws-1', 'test-1', [{
      variantId: 'v-a', impressions: 2147483647, clicks: 0, conversions: 10, spendMinor: 0, revenueMinor: 2147483647,
    }])).resolves.toEqual({ updated: 1 });
  });

  it('refuses invalid stored evidence rather than concluding it', async () => {
    const row = running(); row.variants[0].clicks = -1;
    prisma.testExperiment.findFirst.mockResolvedValue(row);
    await expect(concludeTest('ws-1', 'test-1', { refresh: false }))
      .rejects.toMatchObject({ code: 'INVALID_TEST_METRICS' });
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(prisma.decisionMemoryEntry.create).not.toHaveBeenCalled();
  });

  for (const input of [{ clicks: '1.5' }, { spend: 'Infinity' }, { spend: '-1' }, { impressions: '2147483648' }]) {
    it(`rejects malformed Meta evidence ${JSON.stringify(input)}`, () => {
      expect(() => parseVariantInsights(input, 'USD')).toThrow();
    });
  }
});
