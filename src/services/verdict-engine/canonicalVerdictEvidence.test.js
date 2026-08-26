// ============================================================
// Phase D.4 — the campaign verdict evidence contract
// ============================================================
// This is the first phase in the D track that takes a verdict OFF a screen, so
// the tests are written around the two ways that could go wrong quietly:
//
//   1. An operational row sneaks in and the verdict looks fine while meaning
//      something different from the threshold judging it.
//   2. A campaign with no canonical evidence gets a verdict anyway — from a
//      fallback, a zero, or a stale row — and the absence never surfaces.
//
// Neither fails loudly. Both produce a plausible KILL. Hence the emphasis below
// on the ORDER of filtering and on absence being a returned value rather than
// an empty result.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { metricSnapshot: { findMany: vi.fn() }, campaign: { findMany: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import {
  selectCanonicalVerdictSnapshots, latestCanonicalByEntity, partitionByCanonicalEvidence,
  CANONICAL_VERDICT_WINDOW, CANONICAL_VERDICT_WINDOW_FILTER, PLATFORM_VERDICT_SOURCES,
  CANONICAL_VERDICT_SELECT, NO_CANONICAL_WINDOW, CANONICAL_EVIDENCE_READ_FAILED,
} from './canonicalVerdictEvidence.js';
import { MIN_DAYS } from './verdictEngine.js';
import { getCanonicalVerdictCampaigns } from '../entity-graph/EntityGraphService.js';
import { FATIGUE_FREQ } from './benchmarkProvider.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.resolve(HERE, rel), 'utf8');

// B5-01E — this fixture now carries the WINDOW PROVENANCE a real canonical row
// has. It did not before, and the tests below still passed, because the old
// selector ranked on `date` and validated nothing: a row with no declared window
// and no period was accepted as verdict evidence. No writer emits that shape
// (canonicalWriterConformance.test.js proves what Meta and Google actually
// emit), so the fixture was describing a row that cannot exist.
//
// 2026-07-14 → 2026-08-12 inclusive is exactly 30 days, and ends on the day this
// fixture says it was synced.
const snap = (o = {}) => ({
  entityId: 'c1', date: new Date('2026-08-12T09:00:00Z'), source: 'META',
  measurementWindow: 'CUMULATIVE_30D',
  windowStart: new Date('2026-07-14T00:00:00Z'),
  windowEnd: new Date('2026-08-12T00:00:00Z'),
  spendMinor: 100_000, revenueMinor: 300_000, impressions: 50_000, clicks: 1_000,
  conversions: 20, roas: 3, ctr: 0.02, frequency: 2.1, reach: 24_000, currency: 'USD', ...o,
});

beforeEach(() => vi.clearAllMocks());
const whereOf = () => prisma.metricSnapshot.findMany.mock.calls[0][0].where;

// ── Canonical selection ─────────────────────────────────────────────────────
describe('the selector asks for canonical campaign evidence and nothing else', () => {
  it('pins the window to exactly CUMULATIVE_30D', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalVerdictSnapshots('ws1', ['c1']);
    expect(whereOf().measurementWindow).toEqual({ equals: 'CUMULATIVE_30D' });
    expect(CANONICAL_VERDICT_WINDOW).toBe('CUMULATIVE_30D');
    expect(CANONICAL_VERDICT_WINDOW_FILTER).not.toHaveProperty('in');
  });

  it('scopes to CAMPAIGN — an ad-set row can never stand in for its parent', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalVerdictSnapshots('ws1', ['c1']);
    expect(whereOf().entityLevel).toBe('CAMPAIGN');
  });

  it('admits platform sources only, as an allow-list', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalVerdictSnapshots('ws1', ['c1']);
    expect(whereOf().source).toEqual({ in: PLATFORM_VERDICT_SOURCES });
    for (const actual of ['GA4', 'SHOPIFY', 'MANUAL']) {
      expect(PLATFORM_VERDICT_SOURCES).not.toContain(actual);
    }
    expect(PLATFORM_VERDICT_SOURCES).toContain('META');
    expect(PLATFORM_VERDICT_SOURCES).toContain('GOOGLE');
  });

  it('never consults granularity, which every writer hardcodes', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalVerdictSnapshots('ws1', ['c1']);
    expect(whereOf()).not.toHaveProperty('granularity');
  });

  it('picks the latest of the canonical rows', () => {
    const older = snap({ date: new Date('2026-08-01T09:00:00Z'), spendMinor: 1 });
    const newer = snap({ date: new Date('2026-08-12T09:00:00Z'), spendMinor: 2 });
    expect(latestCanonicalByEntity([newer, older]).get('c1').spendMinor).toBe(2);
    expect(latestCanonicalByEntity([older, newer]).get('c1').spendMinor).toBe(2); // order-independent
  });

  it('returns nothing when asked about no campaigns, without querying', async () => {
    expect(await selectCanonicalVerdictSnapshots('ws1', [])).toEqual([]);
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});

// ── Filter BEFORE latest ────────────────────────────────────────────────────
describe('filtering happens before latest, not after', () => {
  // The whole defect: `date` is the SYNC timestamp, and an operational row lands
  // beside the canonical one on every sync. Reduce-then-check would hand back
  // the operational row, discover it is the wrong window, and report the
  // campaign as unmeasured while its canonical row sat unread.
  it('the query carries every narrowing predicate, so latest ranks eligible rows only', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalVerdictSnapshots('ws1', ['c1']);
    const w = whereOf();
    expect(w.measurementWindow).toBeDefined();
    expect(w.entityLevel).toBeDefined();
    expect(w.source).toBeDefined();
  });

  it('a NEWER operational row cannot outrank an older canonical one', () => {
    // Only canonical rows ever reach the reducer, so a newer operational row is
    // not a competitor — it is not in the set at all.
    const canonical = snap({ date: new Date('2026-08-01T09:00:00Z'), spendMinor: 500 });
    expect(latestCanonicalByEntity([canonical]).get('c1').spendMinor).toBe(500);
  });

  it('the selector source contains no post-hoc window check', () => {
    const text = src('./canonicalVerdictEvidence.js');
    expect(text).not.toMatch(/measurementWindow\s*===/);
    expect(text).not.toMatch(/\?\?\s*operational/i);
  });
});

// ── Absence ─────────────────────────────────────────────────────────────────
describe('missing canonical evidence is returned, not swallowed', () => {
  it('names the campaign and the reason', () => {
    const { withEvidence, absent } = partitionByCanonicalEvidence(
      [{ id: 'c1', name: 'Has' }, { id: 'c2', name: 'Missing' }],
      latestCanonicalByEntity([snap({ entityId: 'c1' })]),
    );
    expect(withEvidence.map((w) => w.identity.id)).toEqual(['c1']);
    expect(absent).toEqual([{ id: 'c2', name: 'Missing', reason: NO_CANONICAL_WINDOW }]);
  });

  it('NO_CANONICAL_WINDOW is distinct from every "no data" reason', () => {
    expect(NO_CANONICAL_WINDOW).toBe('NO_CANONICAL_WINDOW');
    // The dataless reason buildConnectorVerdictTree emits for a campaign that WAS
    // measured and delivered nothing. Same empty cell, opposite fix.
    expect(NO_CANONICAL_WINDOW).not.toBe('no measured revenue or engagement');
  });

  it('fabricates no metrics for a campaign without evidence', () => {
    const { absent } = partitionByCanonicalEvidence([{ id: 'c2', name: 'Missing' }], new Map());
    expect(absent[0]).not.toHaveProperty('spendMinor');
    expect(absent[0]).not.toHaveProperty('revenueMinor');
    expect(absent[0]).not.toHaveProperty('roas');
  });

  it('an empty evidence set makes every campaign absent — never a partial verdict', () => {
    const { withEvidence, absent } = partitionByCanonicalEvidence(
      [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], new Map(),
    );
    expect(withEvidence).toEqual([]);
    expect(absent).toHaveLength(3);
  });

  // B5 F-2 — this used to assert `[]`, which was the defect written down as a
  // guarantee: a failed read produced the SAME value as a campaign that was
  // genuinely never measured. The half that was always right is kept — a failure
  // must not become an unfiltered retry either.
  it('a DB failure raises rather than yielding an empty population', async () => {
    prisma.metricSnapshot.findMany.mockRejectedValue(new Error('boom'));
    await expect(selectCanonicalVerdictSnapshots('ws1', ['c1']))
      .rejects.toMatchObject({ code: CANONICAL_EVIDENCE_READ_FAILED });
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
  });
});

// ── ROAS integrity ──────────────────────────────────────────────────────────
describe('ROAS comes from one row, both halves', () => {
  it('the selected row carries its own revenue AND spend', () => {
    const row = latestCanonicalByEntity([snap({ revenueMinor: 300_000, spendMinor: 100_000 })]).get('c1');
    expect(row.revenueMinor / row.spendMinor).toBe(3);
    expect(row.source).toBe('META');
  });

  // An actual-source row cannot be the numerator because it cannot be in the set:
  // the query excludes its source outright. Asserted on the predicate rather than
  // on a filtered result, because the exclusion must happen in the DB — pulling
  // the rows and dropping them later is one refactor away from keeping one.
  it('actual-source revenue is excluded by the query, not by a later filter', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalVerdictSnapshots('ws1', ['c1']);
    expect(whereOf().source.in).not.toContain('GA4');
    expect(whereOf().source.in).not.toContain('MANUAL');
    expect(whereOf().source.in).not.toContain('SHOPIFY');
  });

  it('the verdict path does not apply the actual-revenue overlay', () => {
    const graph = src('../entity-graph/EntityGraphService.js');
    const canonicalFn = graph.slice(graph.indexOf('export async function getCanonicalVerdictCampaigns'));
    expect(canonicalFn).not.toMatch(/effectiveByEntity/);
  });

  // Excluded from THIS path only — the overlay still serves every other consumer.
  it('effectiveByEntity survives for the operational reader', () => {
    const graph = src('../entity-graph/EntityGraphService.js');
    expect(graph).toMatch(/effectiveByEntity\(snaps\)/);
    expect(src('../entity-graph/entityGraphEngine.js')).toMatch(/export function effectiveByEntity/);
  });
});

// ── Platform parity ─────────────────────────────────────────────────────────
describe('Meta and Google go through the identical contract', () => {
  it('one query serves both — no per-channel branch', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalVerdictSnapshots('ws1', ['c1']);
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    const text = src('./canonicalVerdictEvidence.js');
    expect(text).not.toMatch(/if\s*\(.*META.*\)/);
    expect(text).not.toMatch(/channel\s*===/);
  });

  it('a Google canonical row is selected on the same terms as a Meta one', () => {
    const rows = [snap({ entityId: 'g1', source: 'GOOGLE', frequency: null, reach: null })];
    expect(latestCanonicalByEntity(rows).get('g1').source).toBe('GOOGLE');
  });

  // Google reports no frequency; that is a fatigue concern, not a verdict one.
  it('a null frequency does not disqualify a campaign from having evidence', () => {
    const { withEvidence, absent } = partitionByCanonicalEvidence(
      [{ id: 'g1', name: 'Google' }],
      latestCanonicalByEntity([snap({ entityId: 'g1', source: 'GOOGLE', frequency: null })]),
    );
    expect(withEvidence).toHaveLength(1);
    expect(absent).toEqual([]);
  });
});

// ── The seam is actually wired ──────────────────────────────────────────────
// Added because a negative control exposed the gap: stubbing the selector out
// of getCanonicalVerdictCampaigns entirely left the suite green. Every test
// above exercised the pieces; none proved the verdict reader uses them.
describe('getCanonicalVerdictCampaigns joins identity to canonical evidence', () => {
  const identity = (id, name) => ({
    id, name, channel: 'meta', objective: 'OUTCOME_SALES',
    externalId: `ext_${id}`, platformCreatedTime: new Date('2026-06-01'), _count: { adSets: 2 },
  });

  it('returns a campaign row carrying the CANONICAL row\'s metrics', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Ramadan')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([snap({ entityId: 'c1', spendMinor: 777_000 })]);

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns('ws1');
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({ entityId: 'c1', name: 'Ramadan', spendMinor: 777_000, roas: 3 });
    expect(noCanonicalWindow).toEqual([]);
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1); // one batched read
  });

  it('splits the population: evidence in campaigns, the rest in noCanonicalWindow', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Has'), identity('c2', 'Missing')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([snap({ entityId: 'c1' })]);

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns('ws1');
    expect(campaigns.map((c) => c.entityId)).toEqual(['c1']);
    expect(noCanonicalWindow).toEqual([{ id: 'c2', name: 'Missing', reason: NO_CANONICAL_WINDOW }]);
  });

  it('asks the canonical selector for exactly the campaigns it found', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'A'), identity('c2', 'B')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await getCanonicalVerdictCampaigns('ws1');
    expect(whereOf().entityId).toEqual({ in: ['c1', 'c2'] });
    expect(whereOf().measurementWindow).toEqual({ equals: 'CUMULATIVE_30D' });
  });

  it('a workspace whose campaigns all lack evidence yields no rows, and says so', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'A'), identity('c2', 'B')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns('ws1');
    expect(campaigns).toEqual([]);
    expect(noCanonicalWindow.map((c) => c.reason)).toEqual([NO_CANONICAL_WINDOW, NO_CANONICAL_WINDOW]);
  });

  // THE fallback test, and it counts QUERIES rather than inspecting results —
  // because a fallback that reads operational rows and finds none looks
  // identical to no fallback at all. A second read is the only visible trace,
  // so absence of evidence must cost exactly one query and stop.
  it('absent canonical evidence triggers NO second, operational read', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'A')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await getCanonicalVerdictCampaigns('ws1');

    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    for (const [{ where }] of prisma.metricSnapshot.findMany.mock.calls) {
      expect(where.measurementWindow).toEqual({ equals: 'CUMULATIVE_30D' });
      expect(JSON.stringify(where)).not.toContain('ROLLING_WINDOW');
      expect(JSON.stringify(where)).not.toContain('LEGACY_UNKNOWN');
    }
  });

  it('no campaigns at all → no snapshot query', async () => {
    prisma.campaign.findMany.mockResolvedValue([]);
    const out = await getCanonicalVerdictCampaigns('ws1');
    expect(out).toEqual({ campaigns: [], noCanonicalWindow: [] });
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});

// ── Nothing else moved ──────────────────────────────────────────────────────
describe('the blast radius stops at the verdict evidence source', () => {
  // V is module-private, so the ROAS bars are asserted where they are WRITTEN.
  // Phase D changes what evidence the thresholds see, never the thresholds.
  it('thresholds are untouched', () => {
    expect(MIN_DAYS).toBe(3);
    expect(FATIGUE_FREQ).toBe(3.5);
    const engine = src('./verdictEngine.js');
    expect(engine).toMatch(/BREAKEVEN_ROAS:\s*1\.0/);
    expect(engine).toMatch(/SCALE_ROAS:\s*3\.0/);
  });

  it('latestSnapshots is still the operational reader for everyone else', () => {
    const graph = src('../entity-graph/EntityGraphService.js');
    // R3.9: the operational population moved to the Evidence seam, exactly as
    // the guardrail assertion below already reflects. The claim is unchanged —
    // this file still reads operational rows for the Campaigns surface, and the
    // canonical verdict path beside it is still a separate selector.
    expect(graph).toMatch(/selectOperationalSnapshots/);
    expect(graph).toMatch(/selectCanonicalVerdictSnapshots/);
    expect(graph).toMatch(/export async function getConnectorCampaigns/);
  });

  it('the fatigue path keeps its own selector', () => {
    expect(src('../fatigue-forecaster/canonicalFatigueEvidence.js')).toMatch(/selectCanonicalFatigueSnapshots/);
    for (const consumer of ['../analysis/FatigueForecastService.js', '../scenario-engine/ScenarioService.js']) {
      expect(src(consumer)).not.toMatch(/canonicalVerdictEvidence/);
    }
  });

  it('guardrails stay operational', () => {
    const guard = src('../guardrail-engine/GuardrailSweepService.js');
    // R3 handed the query to the Evidence layer, so the operational population
    // is now declared there rather than inline here. Same population, same
    // exclusion from canonical verdict evidence — different owner.
    expect(guard).toMatch(/selectOperationalSnapshots/);
    expect(guard).not.toMatch(/canonicalVerdictEvidence/);
    expect(guard).not.toMatch(/selectCanonicalVerdictSnapshots/);
  });

  it('the selector cannot reach a money column it has no business in', () => {
    expect(Object.keys(CANONICAL_VERDICT_SELECT)).toContain('spendMinor');
    expect(CANONICAL_VERDICT_SELECT).not.toHaveProperty('entityLevel'); // pinned by the query, not projected
  });

  // R13-D / B1 — measurementWindow moved from "not projected" to "must be".
  //
  // The old assertion sat beside entityLevel under one rationale: pinned by the
  // query, so projecting it is redundant. That was true while the window was
  // only ever an input to arithmetic. It stopped being true when
  // /entities/verdicts had to LABEL the numbers it publishes — a payload that
  // cannot state its period leaves the frontend to assume one.
  //
  // What the old test actually protected is untouched and asserted above: the
  // population is chosen by CANONICAL_VERDICT_WINDOW_FILTER in the `where`, in
  // one place, and no consumer re-reads the column to pick rows (the
  // `measurementWindow ===` guard earlier in this file still holds).
  // entityLevel keeps the original treatment because nothing publishes it.
  it('…but it MUST project the provenance the API has to publish', () => {
    expect(CANONICAL_VERDICT_SELECT.measurementWindow).toBe(true);
    expect(CANONICAL_VERDICT_SELECT.windowStart).toBe(true);
    expect(CANONICAL_VERDICT_SELECT.windowEnd).toBe(true);
  });
});
