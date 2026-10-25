import { canonicalContentHash } from './evidenceReference.js';
// ============================================================
// C-09 · the dimensions cross the wire, and composition stays engine-owned
// ============================================================
// Three allowlists sit between confidenceEngine and the operator — the node
// return in verdictEngine, the projection in connectorVerdictService, and
// verdictInfoByEntityId on the client — and each one drops anything it does not
// name. C-07 lost `reason` on the third. These tests walk the whole path.
//
// They also pin the invariant that publishing dimensions makes newly dangerous:
// the numbers describe the confidence, they do not reconstruct it.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    campaign:       { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    decision:       { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    accountPattern: { findMany: vi.fn() },
  },
}));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots: vi.fn(async () => []) }));

import { prisma } from '../../lib/prisma.js';
import { getConnectorVerdicts } from './connectorVerdictService.js';
import { evaluateVerdict } from './verdictEngine.js';
import { composeConfidence, MAX_CONFIDENCE } from './confidenceEngine.js';
import { applyMemoryToConfidence } from '../pattern-engine/institutionalMemory.js';

const WS = 'ws-c09';
const DAY = 86_400_000;
const NOW = new Date('2026-08-26T09:00:00.000Z');

const identity = (id, name = 'Always On') => ({
  id, name, channel: 'META', objective: 'OUTCOME_SALES',
  externalId: `ext-${id}`, platformCreatedTime: new Date('2025-06-01T00:00:00Z'),
  _count: { adSets: 1 },
});

const snap = (entityId) => {
  const windowEnd = new Date(new Date(NOW.getTime()).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  return {
    entityId, source: 'META', currency: 'USD', measurementWindow: 'CUMULATIVE_30D',
    windowStart: new Date(windowEnd.getTime() - 29 * DAY), windowEnd, date: windowEnd,
    spendMinor: 5_000_000, revenueMinor: 1_000_000, impressions: 400_000, clicks: 6_000,
    conversions: 40, roas: 0.2, ctr: 0.015, frequency: 4.4, reach: 90_000,
    actionMetrics: null, dailyBudgetMinor: null,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.accountPattern.findMany.mockResolvedValue([]);
});

describe('C-09 · dimensions exist exactly where dataConfidence exists', () => {
  it('a scored campaign publishes both, and they agree', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('A')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap('A')]));

    const { verdicts } = await getConnectorVerdicts(WS);
    const v = verdicts[0];

    expect(v.dataConfidence).not.toBeNull();
    expect(v.dataConfidenceDimensions).not.toBeNull();
    const d = v.dataConfidenceDimensions;
    expect(Math.min(Math.round(d.sampleQuality * d.dataCompleteness * d.temporalQuality * 100) / 100, MAX_CONFIDENCE))
      .toBe(v.dataConfidence);
  });

  it('publishes the basis of each dimension, not just its magnitude', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('A')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap('A')]));

    const { verdicts } = await getConnectorVerdicts(WS);
    const d = verdicts[0].dataConfidenceDimensions;

    // Neither impressions nor daysRunning reached the wire before C-09, so a
    // published 0.42 or 0.70 could not be explained or checked by anyone.
    expect(d.impressions).toBe(400_000);
    expect(Number.isFinite(d.daysRunning)).toBe(true);
    expect(Array.isArray(d.dataCompletenessMissingFields)).toBe(true);
  });

  it('a caller with no sample gets NEITHER — never dimensions without a dataConfidence', async () => {
    // The structural rule, tested at the engine because that is where the
    // sampleKnown gate lives: a legacy caller passing ratios and no impressions.
    const r = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { roas: 3, frequency: 1.2, ctr: 2.0 },
      diagnosis: null,
    });
    expect(r.dataConfidence).toBeNull();
    expect(r.dataConfidenceDimensions).toBeNull();
  });

  it('and a caller WITH a sample gets both', () => {
    const r = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { roas: 3, frequency: 1.2, ctr: 2.0, impressions: 50_000, clicks: 900 },
      diagnosis: null, daysRunning: 40,
    });
    expect(r.dataConfidence).not.toBeNull();
    expect(r.dataConfidenceDimensions).not.toBeNull();
  });
});

describe('C-09 · the dimensions survive every allowlist between engine and wire', () => {
  it('survives the relative-ranking pass, which re-stamps the signal half only', async () => {
    // applyRelativeRanking recomposes `confidence` from its own ranking strength
    // and the SAME dataConfidence. If it re-derived the data half, the published
    // dimensions would describe a number no longer on the row.
    prisma.campaign.findMany.mockResolvedValue([identity('A', 'One'), identity('B', 'Two'), identity('C', 'Three')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap('A'), snap('B'), snap('C')]));

    const { verdicts } = await getConnectorVerdicts(WS);
    expect(verdicts.length).toBeGreaterThan(0);
    for (const v of verdicts) {
      expect(v.dataConfidenceDimensions, `${v.id} lost its dimensions`).toBeTruthy();
      const d = v.dataConfidenceDimensions;
      expect(Math.min(Math.round(d.sampleQuality * d.dataCompleteness * d.temporalQuality * 100) / 100, MAX_CONFIDENCE))
        .toBe(v.dataConfidence);
    }
  });
});

describe('C-09 · composition is engine-owned — the halves do NOT rebuild the headline', () => {
  it('signal × data folds to baseConfidence', () => {
    expect(composeConfidence(0.9, 0.8)).toBe(0.72);
  });

  it('but baseConfidence × memoryFactor is NOT a multiplication a consumer can repeat', () => {
    // THE LATENT BUG PUBLISHING MAKES REACHABLE. applyMemoryToConfidence clamps
    // and re-rounds, so a consumer that multiplies the published numbers can
    // land on a different figure and believe it is the truth.
    const base = composeConfidence(0.99, 0.99);      // 0.98 → capped to 0.97
    expect(base).toBe(MAX_CONFIDENCE);

    const applied = applyMemoryToConfidence(base, 1.2);
    expect(applied).toBe(MAX_CONFIDENCE);            // the cap bites again
    expect(applied).not.toBe(Math.round(base * 1.2 * 100) / 100);
  });

  it('a memory factor of 1 leaves the deterministic number bit-identical', () => {
    const base = composeConfidence(0.9, 0.8);
    expect(applyMemoryToConfidence(base, 1)).toBe(base);
  });

  it('the row publishes both, so the adjustment stays auditable', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('A')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap('A')]));

    const { verdicts } = await getConnectorVerdicts(WS);
    const v = verdicts[0];
    expect(v.baseConfidence).not.toBeNull();
    expect(v.confidence).not.toBeNull();
    expect(v.signalConfidence).not.toBeNull();
    expect(composeConfidence(v.signalConfidence, v.dataConfidence)).toBe(v.baseConfidence);
  });
});

describe('C-09 · nothing that already existed moved', () => {
  it('publishes the same confidence chain it published before the dimensions', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('A')]);
    prisma.$queryRaw.mockResolvedValue(captured([snap('A')]));

    const { verdicts } = await getConnectorVerdicts(WS);
    const v = verdicts[0];
    // Fixed inputs → fixed numbers, MEASURED on trunk before the dimensions
    // existed. If a refactor of computeConfidence changed any arithmetic, this
    // is where it shows — on the published payload, not in a unit.
    //
    // 400 000 impressions → sample 1.00 (saturated)
    // no actionMetrics    → completeness 0.75 (LPV −0.15, ATC −0.10)
    // 451 days running    → temporal 1.00
    expect(v.dataConfidence).toBe(0.75);
    expect(v.dataConfidenceDimensions.sampleQuality).toBe(1);
    expect(v.dataConfidenceDimensions.temporalQuality).toBe(1);
    expect(v.dataConfidenceDimensions.dataCompleteness).toBeCloseTo(0.75, 5);
    expect([...v.dataConfidenceDimensions.dataCompletenessMissingFields].sort()).toEqual(['ATC', 'LPV']);
  });
});


// Synthetic immutable capture results at the actual observation-query seam.
// These are unit fixtures, not authority for legacy database snapshots.
const captured = (rows, workspaceId = WS) => rows.map((row, index) => {
  const committedProjection = { formatVersion: 1,
    snapshot: JSON.parse(JSON.stringify({ ...row, workspaceId, entityLevel: 'CAMPAIGN' })),
    attributes: { objective: 'OUTCOME_SALES' } };
  const day = (v) => v == null ? null : new Date(v).toISOString().slice(0, 10);
  const sourceFacts = { binding: 'EXACT', providerAccountId: 'act_unit',
    rawDates: { start: { presence: row.windowStart ? 'VALID' : 'MISSING', value: day(row.windowStart) },
      stop: { presence: row.windowEnd ? 'VALID' : 'MISSING', value: day(row.windowEnd) } },
    metricFields: { spend: 'VALID', impressions: 'VALID', clicks: 'VALID', revenue: 'VALID', conversions: 'VALID', frequency: 'VALID' } };
  const id = (n) => '10000000-0000-4000-8000-' + String(index * 4 + n).padStart(12, '0');
  return { workspaceId, entityId: row.entityId, observationId: id(1), refreshId: id(2),
    sourceAttemptId: id(3), writeId: id(4), committedProjection, sourceFacts,
    contentHash: canonicalContentHash({ projection: committedProjection, facts: sourceFacts }).toString('hex'),
    sourceScope: { providerAccountId: 'act_unit' }, sourceReceipt: { outcome: 'EXHAUSTED' } };
});
