// ============================================================
// Phase K — the fatigue evidence contract
// ============================================================
// Fatigue is judged against ONE threshold (FATIGUE_FREQ 3.5) by three services
// that used to read three different populations. The failure this file exists to
// prevent is not a crash: it is the same campaign reading 2.9 on the Growth
// board and 3.6 in a persisted prediction, because one measured the sync window
// and the other measured 30 days. Nothing would throw, and both numbers would
// trace to a real row.
//
// So these tests assert the boundary itself — which window is evidence, which
// entity a row may speak for, what happens when there is no evidence, and that
// all three consumers ask the same question — plus the structural invariants
// (§18 H/I/J/K) that keep the boundary from being quietly re-crossed later.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => {
  const prisma = {
    metricSnapshot:    { findMany: vi.fn() },
    fatiguePrediction: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    decisionMemoryEntry: { create: vi.fn() },
    accountPattern:    { findMany: vi.fn() },
    workspace:         { findUnique: vi.fn() },
    $transaction:      vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (ops) => Promise.all(ops));
  return { prisma };
});

import { prisma } from '../../lib/prisma.js';
import {
  selectCanonicalFatigueSnapshots, latestCanonicalByEntity,
  CANONICAL_FATIGUE_WINDOW, CANONICAL_FATIGUE_WINDOW_FILTER, CANONICAL_FATIGUE_SELECT,
} from './canonicalFatigueEvidence.js';
import { sweepFatigue } from './FatigueSweepService.js';
import { computeFatigueForecast } from '../analysis/FatigueForecastService.js';
import { gatherLeadingSignals } from '../scenario-engine/ScenarioService.js';
import { FATIGUE_FREQ } from '../verdict-engine/benchmarkProvider.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.resolve(HERE, rel), 'utf8');

const day = (n) => new Date(Date.UTC(2026, 7, n)).toISOString();
const canon = (entityId, entityLevel, freqs, reach = 5000) =>
  freqs.map((frequency, i) => ({
    entityId, entityLevel, date: day(1 + i), frequency, ctr: 0.02, reach,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.fatiguePrediction.findMany.mockResolvedValue([]);
  prisma.fatiguePrediction.deleteMany.mockResolvedValue({ count: 0 });
  prisma.fatiguePrediction.createMany.mockResolvedValue({ count: 0 });
});

const whereOf = (call = 0) => prisma.metricSnapshot.findMany.mock.calls[call][0].where;

// ── A · canonical selection ─────────────────────────────────────────────────
describe('A · the selector asks for canonical evidence and nothing else', () => {
  it('filters to exactly CUMULATIVE_30D', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalFatigueSnapshots('ws1');
    expect(whereOf().measurementWindow).toEqual({ equals: 'CUMULATIVE_30D' });
    expect(CANONICAL_FATIGUE_WINDOW).toBe('CUMULATIVE_30D');
  });

  // `equals`, not `in`: a single-valued list is one edit away from a second value.
  it('pins the window to a single value, not a list', () => {
    expect(CANONICAL_FATIGUE_WINDOW_FILTER).toEqual({ equals: 'CUMULATIVE_30D' });
    expect(CANONICAL_FATIGUE_WINDOW_FILTER).not.toHaveProperty('in');
  });

  it('requires a real frequency and real delivery', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalFatigueSnapshots('ws1');
    expect(whereOf().frequency).toEqual({ not: null });
    expect(whereOf().impressions).toEqual({ gt: 0 });
  });

  it('never consults granularity, which every writer hardcodes to DAILY', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalFatigueSnapshots('ws1');
    expect(whereOf()).not.toHaveProperty('granularity');
  });
});

// ── B · no operational fallback ─────────────────────────────────────────────
describe('B · no canonical evidence yields no evidence, never an operational read', () => {
  it('returns empty and issues no second query', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    expect(await selectCanonicalFatigueSnapshots('ws1')).toEqual([]);
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
  });

  it('a DB failure degrades to empty, not to an unfiltered retry', async () => {
    prisma.metricSnapshot.findMany.mockRejectedValue(new Error('boom'));
    expect(await selectCanonicalFatigueSnapshots('ws1')).toEqual([]);
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
  });

  it('the sweep writes no prediction when canonical evidence is absent', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    const out = await sweepFatigue('ws1');
    expect(out.written).toBe(0);
    expect(prisma.fatiguePrediction.createMany).not.toHaveBeenCalled();
  });

  it('the scenario path emits no leading signal when canonical evidence is absent', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    expect(await gatherLeadingSignals('ws1', { entityIds: ['c1'] })).toEqual([]);
  });
});

// ── C · mixed-window rejection ──────────────────────────────────────────────
describe('C · only CUMULATIVE_30D is eligible', () => {
  for (const rejected of ['ROLLING_WINDOW', 'LEGACY_UNKNOWN', 'DAILY']) {
    it(`refuses ${rejected}`, async () => {
      prisma.metricSnapshot.findMany.mockResolvedValue([]);
      await selectCanonicalFatigueSnapshots('ws1');
      const w = whereOf().measurementWindow;
      expect(w.equals).not.toBe(rejected);
      // Nor smuggled in through a list the query might also carry.
      expect(JSON.stringify(w)).not.toContain(rejected);
    });
  }
});

// ── D · entity-level isolation ──────────────────────────────────────────────
describe('D · levels are preserved and never rolled up', () => {
  it('scopes to one level when asked', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalFatigueSnapshots('ws1', { entityLevel: 'ADSET' });
    expect(whereOf().entityLevel).toBe('ADSET');
  });

  it('sweeps every level at once, without an aggregation step', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([
      ...canon('c1', 'CAMPAIGN', [3.0, 3.4]),
      ...canon('s1', 'ADSET',    [2.0, 2.6]),
      ...canon('a1', 'AD',       [1.0, 1.9]),
    ]);
    await sweepFatigue('ws1');
    expect(whereOf()).not.toHaveProperty('entityLevel'); // all levels
    const written = prisma.fatiguePrediction.createMany.mock.calls[0][0].data;
    // Each entity carries its OWN level — no child folded into a parent.
    expect(written.map((r) => r.entityLevel).sort()).toEqual(['AD', 'ADSET', 'CAMPAIGN']);
    expect(written.map((r) => r.entityId).sort()).toEqual(['a1', 'c1', 's1']);
  });

  it('keeps two levels apart even when they share an entityId', async () => {
    // detId hashes the level in, so this cannot arise from the connector — the
    // point is that the contract does not RELY on that to stay correct.
    const latest = latestCanonicalByEntity([
      ...canon('shared', 'CAMPAIGN', [3.0], 100),
      ...canon('shared', 'ADSET',    [7.0], 200),
    ]);
    expect(latest.get('shared:CAMPAIGN').frequency).toBe(3.0);
    expect(latest.get('shared:ADSET').frequency).toBe(7.0);
    expect(latest.size).toBe(2);
  });

  it('a campaign forecast never reads an ad-set row', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await computeFatigueForecast('ws1', [{ entityId: 'c1', name: 'A', channel: 'meta' }]);
    expect(whereOf().entityLevel).toBe('CAMPAIGN');
  });
});

// ── E/F · level metrics are used, never aggregated ──────────────────────────
describe('E/F · frequency and reach are used directly', () => {
  it('takes the latest observation, not a sum or a mean', () => {
    const latest = latestCanonicalByEntity(canon('c1', 'CAMPAIGN', [3.0, 3.1, 3.2], 5000));
    const row = latest.get('c1:CAMPAIGN');
    expect(row.frequency).toBe(3.2);
    expect(row.frequency).not.toBe(9.3);                      // Σ frequency
    expect(row.frequency).not.toBeCloseTo(3.1, 5);            // AVG frequency
    expect(row.reach).toBe(5000);
    expect(row.reach).not.toBe(15_000);                       // Σ reach
  });

  it('exposes reach as evidence, and never money', () => {
    expect(CANONICAL_FATIGUE_SELECT.reach).toBe(true);
    expect(CANONICAL_FATIGUE_SELECT.frequency).toBe(true);
    for (const money of ['spendMinor', 'revenueMinor', 'roas', 'conversions', 'cpaMinor']) {
      expect(CANONICAL_FATIGUE_SELECT).not.toHaveProperty(money);
    }
  });

  it('surfaces canonical frequency and reach unchanged through the forecast', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(canon('c1', 'CAMPAIGN', [3.0, 3.2], 4321));
    const [row] = await computeFatigueForecast('ws1', [{ entityId: 'c1', name: 'A', channel: 'meta' }]);
    expect(row.currentFrequency).toBe(3.2);
    expect(row.reach).toBe(4321);
  });
});

// ── G · insufficient history ────────────────────────────────────────────────
describe('G · a forecast needs two distinct days of canonical observation', () => {
  it('0 observations → no prediction', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    expect((await sweepFatigue('ws1')).written).toBe(0);
  });

  it('1 observation → no prediction, and no synthetic second point', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(canon('c1', 'CAMPAIGN', [3.4]));
    const out = await sweepFatigue('ws1');
    expect(out.forecastable).toBe(0);
    expect(out.written).toBe(0);
  });

  // Two rows from ONE day are one observation of a 30-day level, not a trend.
  // Before Phase K this path counted rows, so two syncs an hour apart fitted a
  // velocity across minutes and projected a breach out of nothing.
  it('2 observations on the SAME day → no prediction', async () => {
    const sameDay = [
      { entityId: 'c1', entityLevel: 'CAMPAIGN', date: day(1), frequency: 3.0, ctr: 0.02, reach: 5000 },
      { entityId: 'c1', entityLevel: 'CAMPAIGN', date: new Date(Date.UTC(2026, 7, 1, 18)).toISOString(), frequency: 3.4, ctr: 0.02, reach: 5200 },
    ];
    prisma.metricSnapshot.findMany.mockResolvedValue(sameDay);
    expect((await sweepFatigue('ws1')).forecastable).toBe(0);

    vi.clearAllMocks();
    prisma.metricSnapshot.findMany.mockResolvedValue(sameDay);
    expect(await gatherLeadingSignals('ws1', { entityIds: ['c1'] })).toEqual([]);
  });

  it('2 distinct days → the existing algorithm runs', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(canon('c1', 'CAMPAIGN', [3.0, 3.4]));
    const out = await sweepFatigue('ws1');
    expect(out.forecastable).toBe(1);
    expect(out.written).toBe(1);
  });
});

// ── H · one contract across all three consumers ─────────────────────────────
describe('H · all three fatigue consumers share the one selector', () => {
  const CONSUMERS = [
    ['FatigueForecastService', '../analysis/FatigueForecastService.js'],
    ['FatigueSweepService',    './FatigueSweepService.js'],
    ['ScenarioService',        '../scenario-engine/ScenarioService.js'],
  ];

  for (const [name, rel] of CONSUMERS) {
    it(`${name} imports selectCanonicalFatigueSnapshots`, () => {
      expect(src(rel)).toMatch(/selectCanonicalFatigueSnapshots/);
    });

    // The whole point of one contract is that nobody keeps a private copy of it.
    it(`${name} hand-rolls no window filter of its own`, () => {
      const text = src(rel);
      expect(text).not.toMatch(/measurementWindow\s*:/);
      expect(text).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
      expect(text).not.toMatch(/CUMULATIVE_30D['"]/);
    });
  }

  it('all three issue the identical window predicate at runtime', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await computeFatigueForecast('ws1', [{ entityId: 'c1', name: 'A', channel: 'meta' }]);
    await sweepFatigue('ws1');
    await gatherLeadingSignals('ws1', { entityIds: ['c1'] });

    const windows = prisma.metricSnapshot.findMany.mock.calls.map((c) => c[0].where.measurementWindow);
    expect(windows).toHaveLength(3); // one read each, no consumer querying twice
    for (const w of windows) expect(w).toEqual({ equals: 'CUMULATIVE_30D' });
  });
});

// ── I · the shared entity-graph boundary is untouched ───────────────────────
describe('I · EntityGraphService.latestSnapshots stays operational', () => {
  const ENTITY_GRAPH = '../entity-graph/EntityGraphService.js';

  it('still reads the operational population', () => {
    // R3.9 handed the query to the Evidence layer, so the population is declared
    // there rather than inline here. Same population, same exclusion from
    // canonical evidence — different owner. (Same update the guardrail assertion
    // took in an earlier R3 PR.)
    expect(src(ENTITY_GRAPH)).toMatch(/selectOperationalSnapshots/);
    expect(src(ENTITY_GRAPH)).not.toMatch(/selectCanonicalFatigueSnapshots/);
  });

  // If latestSnapshots itself ever gained a canonical selector, ROAS, CTR,
  // spend and revenue would silently change period along with frequency — the
  // exact blast radius Phase K routed around.
  //
  // Scoped to the FUNCTION, not the file: Phase D.4 added a separate
  // getCanonicalVerdictCampaigns to this module, which is canonical on purpose
  // and reads the VERDICT selector. A file-wide check would have to be deleted
  // to let that land, taking the guard with it — so it is narrowed to what it
  // actually meant instead.
  it('does not consume the canonical fatigue selector', () => {
    expect(src(ENTITY_GRAPH)).not.toMatch(/canonicalFatigueEvidence/);
  });

  it('latestSnapshots itself still reads the operational population', () => {
    const text = src(ENTITY_GRAPH);
    const fn = text.slice(text.indexOf('async function latestSnapshots'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // Still scoped to the FUNCTION rather than the file, for the reason above:
    // getCanonicalVerdictCampaigns lives in this module and is canonical on
    // purpose. What changed in R3.9 is only WHERE the operational population is
    // stated — the seam owns it now, and this function names the seam.
    expect(body).toMatch(/selectOperationalSnapshots/);
    expect(body).not.toMatch(/CUMULATIVE_30D/);
    // Anchored to a CALL, not the word: the comment inside this function
    // explains why canonical rows are excluded, and that explanation is the
    // reason the guard exists rather than something for it to trip over.
    expect(body).not.toMatch(/selectCanonical/);
  });
});

// ── J · the threshold is untouched ──────────────────────────────────────────
describe('J · FATIGUE_FREQ is not recalibrated', () => {
  it('is still exactly 3.5', () => {
    expect(FATIGUE_FREQ).toBe(3.5);
  });

  // Phase K changes what the number is measured over, not what it is. A new
  // per-level ceiling would mean the levels had stopped sharing one meaning.
  it('has no per-level or per-window variant', () => {
    const bench = src('../verdict-engine/benchmarkProvider.js');
    for (const forbidden of ['DAILY_FATIGUE_FREQ', 'ADSET_FATIGUE_FREQ', 'AD_FATIGUE_FREQ', 'CANONICAL_FATIGUE_FREQ']) {
      expect(bench).not.toContain(forbidden);
    }
  });
});

// ── K · no metric contamination ─────────────────────────────────────────────
describe('K · Phase K moves fatigue metrics only', () => {
  it('the selector cannot return a money or funnel column', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalFatigueSnapshots('ws1');
    const { select } = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(Object.keys(select).sort()).toEqual(['ctr', 'date', 'entityId', 'entityLevel', 'frequency', 'reach']);
  });

  it('the verdict path keeps its own reader untouched', () => {
    const eg = src('../entity-graph/EntityGraphService.js');
    // The verdict metrics still come from METRIC_SELECT on the operational read.
    for (const metric of ['spendMinor', 'roas', 'ctr', 'revenueMinor', 'impressions', 'clicks']) {
      expect(eg).toContain(metric);
    }
  });

  it('the guardrail sweep is not converted', () => {
    const guard = src('../guardrail-engine/GuardrailSweepService.js');
    expect(guard).not.toMatch(/canonicalFatigueEvidence/);
    // R3 moved the guardrail query into the Evidence layer, so the file no
    // longer names OPERATIONAL_WINDOW_FILTER — the population it reads is
    // unchanged, and the seam it reads it through is what now says so. The
    // claim this test makes ("still operational, still not fatigue evidence")
    // is identical; only the place the claim is written down has moved.
    expect(guard).toMatch(/selectOperationalSnapshots/);
  });
});
