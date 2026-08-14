// ============================================================
// R3.6 — Plan actuals migrated onto the Evidence seam
// ============================================================
// R3.10 finished the job: the distinct/take:50 entity-id scan in
// projectGoalLanding is now on the seam too, so PlanService holds ZERO direct
// MetricSnapshot reads and this file owns BOTH of its queries. The R3.6 half
// below is unchanged; the R3.10 half is at the bottom.
//
// A separate file from PlanService.test.js, which owns the planning contract.
// This one owns the two operational reads: the series behind
// buildActualsSeries(), and the entity scan behind projectGoalLanding().
//
// WHAT IS PROVEN, AND WHERE
// -------------------------
// buildActualsSeries is not exported, so the series is observed where it is
// actually consumed: as the `actuals` argument handed to estimateLanding. That
// is the migrated unit's real output, not a derivation of it — asserting on the
// landing instead would put the goal-tracker's arithmetic between the test and
// the thing being protected. estimateLanding is wrapped rather than replaced, so
// the real engine still runs behind the capture.
//
// A FAKE TABLE, NOT A CANNED ROW LIST
// ------------------------------------
// A mock that returns fixed rows however it is asked cannot see the mutations
// that matter: dropping workspaceId, dropping the `since` bound, admitting
// canonical rows or losing the ordering all return the same array. So findMany
// here APPLIES what it is handed — predicates, orderBy, distinct and take.
//
// THE BUCKETING DEFECT IS PRESERVED ON PURPOSE
// ---------------------------------------------
// The series buckets by `date.slice(0, 10)` where `date` is the SYNC timestamp,
// so two syncs on one calendar date collapse into one point and a date with no
// sync gets none. That is a real defect, found in R2, and R3.6 must not repair
// it: this file asserts the CURRENT behaviour so the repair, when it comes, is a
// visible change rather than a silent one.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Wrapped, not replaced: the real engine still runs, and the spy is how the
// migrated function's output becomes observable.
vi.mock('../goal-tracker/goalTrackerEngine.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, estimateLanding: vi.fn(orig.estimateLanding) };
});
vi.mock('../scenario-engine/ScenarioService.js', () => ({
  runScenario: vi.fn(),
  gatherLeadingSignals: vi.fn(async () => []),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    metricSnapshot: { findMany: vi.fn() },
    plan:           { findFirst: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { estimateLanding } from '../goal-tracker/goalTrackerEngine.js';
import { gatherLeadingSignals } from '../scenario-engine/ScenarioService.js';
import { trackPlan } from './PlanService.js';
import { TEMPORAL } from '../../config/temporal.js';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'PlanService.js'),
  'utf8',
);

const WS = 'ws-plan';

// ── The literal pre-migration query ─────────────────────────────────────────
//
// Reconstructed BY HAND from the diff. Importing OPERATIONAL_WINDOW_FILTER or
// OPERATIONAL_ORDER_BY here would let the test agree with the implementation
// about what the population and the ordering are — which is exactly the
// agreement a parity test must withhold.
const PRE_MIGRATION_SELECT = {
  date: true, spendMinor: true, revenueMinor: true, conversions: true, source: true,
};
const PRE_MIGRATION_WINDOWS = { in: ['LEGACY_UNKNOWN', 'ROLLING_WINDOW'] };
const PRE_MIGRATION_ORDER = { date: 'asc' };

// ── The fake table ──────────────────────────────────────────────────────────

// `entityId` is defaulted (R3.10) because the SECOND read projects it and
// nothing else. It is invisible to the actuals read — that read's projection
// does not include it — so the R3.6 fixture below is unchanged in effect.
const rowOf = (over) => ({
  workspaceId: WS, measurementWindow: 'ROLLING_WINDOW', source: 'META',
  entityId: 'e-base',
  spendMinor: 0, revenueMinor: 0, conversions: 0, ...over,
});

// Deliberately NOT in date order, so losing the ORDER BY changes the series the
// test reads rather than merely the arguments it inspects.
const TABLE = [
  // 5 Aug, the later bucket, placed first
  rowOf({ date: new Date('2026-08-05T09:00:00Z'), spendMinor: 20_000, revenueMinor: 60_000,
    conversions: 8, measurementWindow: 'LEGACY_UNKNOWN' }),
  // a non-platform source: FETCHED by the seam, skipped by Plan in memory
  rowOf({ date: new Date('2026-08-05T10:00:00Z'), source: 'GA4', spendMinor: 999_000,
    revenueMinor: 999_000, conversions: 999, measurementWindow: 'LEGACY_UNKNOWN' }),
  // 1 Aug, two syncs on ONE calendar date — they SUM into one bucket (the
  // sync-date bucketing this PR preserves rather than repairs).
  //
  // Their RATIOS differ on purpose. An earlier draft gave both rows the same
  // ROAS and the same CAC, which made "summed" and "first row wins" produce
  // identical values — so a `distinct: ['date']` mutation at the seam passed
  // every output assertion and was caught only in the query arguments. Two rows
  // that agree prove nothing about how they were combined.
  rowOf({ date: new Date('2026-08-01T09:00:00Z'), spendMinor: 10_000, revenueMinor: 30_000, conversions: 10 }),
  rowOf({ date: new Date('2026-08-01T15:00:00Z'), source: 'GOOGLE', entityId: 'e-second',
    spendMinor: 10_000, revenueMinor: 10_000, conversions: 30 }),
  // canonical: same window-day as a real bucket, excluded by the population
  rowOf({ date: new Date('2026-08-03T09:00:00Z'), measurementWindow: 'CUMULATIVE_30D',
    entityId: 'e-canonical', spendMinor: 777_000, revenueMinor: 777_000, conversions: 777 }),
  // older than any 60-day bound. For the ACTUALS read that makes it invisible;
  // for the ENTITY scan, which has no recency bound, it is a legitimate entity —
  // which is what makes an accidental `since` observable down there.
  rowOf({ date: new Date('2026-01-01T09:00:00Z'), entityId: 'e-ancient',
    spendMinor: 888_000, revenueMinor: 888_000, conversions: 888 }),
  // another tenant, inside the window
  rowOf({ date: new Date('2026-08-02T09:00:00Z'), workspaceId: 'ws-other', entityId: 'e-otherws',
    spendMinor: 666_000, revenueMinor: 666_000, conversions: 666 }),
];

// ── The entity-scan fixture (R3.10) ─────────────────────────────────────────
//
// The second read caps at 50, so proving the cap needs more than 50 eligible
// entities. These fillers are GA4-sourced, which makes them INVISIBLE to the
// actuals series (Plan skips non-platform rows in memory) while being perfectly
// eligible for the entity scan, which applies no source filter. So one table
// serves both reads without the fillers perturbing the R3.6 expectations.
//
// Their dates DESCEND with the index, deliberately: the entity scan has no
// ORDER BY, so an accidentally-added one changes WHICH 50 survive rather than
// only the arguments.
const FILLER_COUNT = 60;
const FILLERS = Array.from({ length: FILLER_COUNT }, (_, i) => rowOf({
  entityId: `e-${String(i).padStart(3, '0')}`,
  source:   'GA4',
  date:     new Date(Date.parse('2026-08-06T00:00:00Z') + (FILLER_COUNT - i) * 3_600_000),
}));

const ENTITY_TABLE = [...TABLE, ...FILLERS];

// Hand-derived from the pre-migration query semantics, NOT from the helper:
//   workspace ws-other        → excluded  (e-otherws)
//   CUMULATIVE_30D            → excluded  (e-canonical)
//   no recency bound          → e-ancient is IN
//   distinct: ['entityId']    → e-base's four rows collapse to one
//   take: 50, applied after   → the first 50 in storage order survive
// With no ORDER BY, "storage order" is genuinely unspecified in Postgres; the
// fake reproduces table order, which is the honest analogue. What the assertions
// below rest on is the CAP and the MEMBERSHIP SHIFTS, not the identity of row 50.
const EXPECTED_SCAN_ENTITIES = [
  'e-base', 'e-second', 'e-ancient',
  ...FILLERS.slice(0, 47).map((r) => r.entityId),
];

// 1 Aug bucket: spend 20 000, revenue 40 000, conv 40  → ROAS 2, CAC   500
//   (first row alone would read ROAS 3, CAC 1 000 — the values a reduction gives)
// 5 Aug bucket: spend 20 000, revenue 60 000, conv  8  → ROAS 3, CAC 2 500
// 2/3/4 Aug: no point at all — a calendar day without a sync is absent, which is
// the defect being preserved, not a gap in the fixture.
const EXPECTED_ROAS_SERIES = [
  { date: '2026-08-01', value: 2 },
  { date: '2026-08-05', value: 3 },
];

const fakeFindMany = (table) => (args = {}) => {
  const w = args.where ?? {};
  let rows = table.filter((r) => (
    (w.workspaceId === undefined || r.workspaceId === w.workspaceId)
    && (w.measurementWindow === undefined || w.measurementWindow.in.includes(r.measurementWindow))
    && (w.entityId === undefined || w.entityId.in.includes(r.entityId))
    && (w.source === undefined || w.source.in.includes(r.source))
    && (w.date === undefined || r.date >= w.date.gte)
  ));
  // Ordering is APPLIED, so dropping it changes the series and not just the args.
  if (args.orderBy?.date === 'asc')  rows = [...rows].sort((a, b) => a.date - b.date);
  if (args.orderBy?.date === 'desc') rows = [...rows].sort((a, b) => b.date - a.date);
  if (args.distinct) {
    const seen = new Set();
    rows = rows.filter((r) => {
      const k = [].concat(args.distinct).map((f) => r[f]).join('|');
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }
  if (args.take != null) rows = rows.slice(0, args.take);
  return Promise.resolve(rows.map((r) => Object.fromEntries(
    Object.keys(args.select ?? r).filter((k) => (args.select ?? r)[k]).map((k) => [k, r[k]]),
  )));
};

const useTable = (table = TABLE) => {
  prisma.metricSnapshot.findMany.mockImplementation(fakeFindMany(table));
};

const planWith = (metric = 'blendedRoas') => ({
  id: 'p1',
  goals: [{
    id: 'g1', metric, comparator: 'GTE', targetValue: 2, spendCeilingMinor: null,
    periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-08-31T00:00:00Z',
  }],
});

/** The FIRST findMany is buildActualsSeries; the second is the un-migrated scan. */
const actualsArgs = () => prisma.metricSnapshot.findMany.mock.calls[0][0];
/** The series buildActualsSeries produced, as it reaches the goal tracker. */
const seriesOf = () => estimateLanding.mock.calls[0][0].actuals;

beforeEach(() => {
  vi.clearAllMocks();
  useTable();
});

describe('R3.6 — Plan actuals on the Evidence seam', () => {
  // ── ownership ────────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('PlanService queries MetricSnapshot nowhere — both reads are on the seam', () => {
      // R3.6 moved the first; R3.10 moved the second. This file no longer states
      // where any of its evidence lives.
      expect(SRC).toMatch(/selectOperationalSnapshots/);
      expect((SRC.match(/prisma\.metricSnapshot/g) || []).length).toBe(0);
      expect(SRC).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
      expect(SRC).not.toMatch(/measurementWindow/);
    });

    it('the entity scan kept its reduction — it just asks the seam for it now', () => {
      // Named explicitly so a future edit cannot drop the reduction while
      // leaving the migration looking done.
      expect(SRC).toMatch(/distinct:\s*\['entityId'\]/);
      expect(SRC).toMatch(/take:\s*50/);
      // And the actuals read's old shape is genuinely gone.
      expect(SRC).not.toMatch(/orderBy:\s*\{\s*date:\s*'asc'\s*\}/);
    });

    it('keeps its OWN error swallow at its OWN call site', () => {
      // Anchored on the actuals projection, which appears exactly once, so the
      // match cannot drift to the `.catch(() => [])` on the entity scan below.
      expect(SRC).toMatch(/source: true \},\s*\}\)\.catch\(\(\) => \[\]\)/);
    });

    it('keeps the platform source set in the service, not in the seam', () => {
      expect(SRC).toMatch(/const PLATFORM = new Set\(\['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN'\]\)/);
      expect(SRC).toMatch(/if \(!PLATFORM\.has\(r\.source\)\) continue;/);
    });
  });

  // ── query parity against a hand-written reconstruction ───────────────────
  describe('query parity with the pre-migration read', () => {
    it('issues exactly the pre-migration query, key for key', async () => {
      const before = Date.now();
      await trackPlan(WS, planWith());
      const after = Date.now();
      const args = actualsArgs();

      expect(args.where.workspaceId).toBe(WS);
      expect(args.where.measurementWindow).toEqual(PRE_MIGRATION_WINDOWS);
      expect(args.select).toEqual(PRE_MIGRATION_SELECT);
      expect(args.orderBy).toEqual(PRE_MIGRATION_ORDER);

      const days = TEMPORAL.planActualsSyncRecencyDays;
      const gte = args.where.date.gte.getTime();
      expect(gte).toBeGreaterThanOrEqual(before - days * 86_400_000);
      expect(gte).toBeLessThanOrEqual(after - days * 86_400_000);

      // Nothing added, nothing dropped, at either level.
      expect(Object.keys(args.where).sort()).toEqual(['date', 'measurementWindow', 'workspaceId']);
      expect(Object.keys(args).sort()).toEqual(['orderBy', 'select', 'where']);
    });

    it('bounds sync recency on `date`, never windowStart/windowEnd', async () => {
      await trackPlan(WS, planWith());
      expect(actualsArgs().where.date).toBeDefined();
      expect(actualsArgs().where.windowStart).toBeUndefined();
      expect(actualsArgs().where.windowEnd).toBeUndefined();
    });

    it('uses the configured 60-day bound, unrenamed and unchanged', async () => {
      expect(TEMPORAL.planActualsSyncRecencyDays).toBe(60);
      const before = Date.now();
      await trackPlan(WS, planWith());
      expect(actualsArgs().where.date.gte.getTime()).toBeLessThanOrEqual(before - 59 * 86_400_000);
    });

    it('applies no source filter in the QUERY — the skip stays in memory', async () => {
      await trackPlan(WS, planWith());
      expect(actualsArgs().where.source).toBeUndefined();
    });

    it('narrows to no entity list — this read is workspace-wide by contract', async () => {
      await trackPlan(WS, planWith());
      expect(actualsArgs().where.entityId).toBeUndefined();
    });

    it('adds no reduction at the Evidence layer', async () => {
      await trackPlan(WS, planWith());
      expect(actualsArgs().distinct).toBeUndefined();
      expect(actualsArgs().take).toBeUndefined();
      expect(actualsArgs().skip).toBeUndefined();
    });

    it('reads evidence twice per goal — the series and the entity scan, no more', async () => {
      // A fallback would show as a third call. The count is the assertion,
      // because an empty second population returns the same shape as none.
      await trackPlan(WS, planWith());
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(2);
      expect(actualsArgs().select).toEqual(PRE_MIGRATION_SELECT);
      // …and the second call is unmistakably the entity scan, now also on the
      // seam. Its own parity is proven in the R3.10 block below.
      const second = prisma.metricSnapshot.findMany.mock.calls[1][0];
      expect(second.select).toEqual({ entityId: true });
      expect(second.distinct).toEqual(['entityId']);
      expect(second.take).toBe(50);
    });

    it('the ACTUALS read is untouched by the seam gaining a reduction', async () => {
      // R3.10 added `distinct` and `take` to the shared selector. The whole
      // safety of that depends on this: the read beside it must be byte-identical
      // to what it was, keys included.
      await trackPlan(WS, planWith());
      expect(Object.keys(actualsArgs()).sort()).toEqual(['orderBy', 'select', 'where']);
      expect(Object.prototype.hasOwnProperty.call(actualsArgs(), 'distinct')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(actualsArgs(), 'take')).toBe(false);
    });
  });

  // ── OUTPUT parity — the series, not the arguments ───────────────────────
  describe('actuals series output parity', () => {
    it('produces the same daily series the direct query produced', async () => {
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf()).toEqual(EXPECTED_ROAS_SERIES);
    });

    it('another tenant\'s rows never enter a bucket', async () => {
      await trackPlan(WS, planWith('blendedRoas'));
      // ws-other's row would have landed on 2 Aug with a ROAS of 1.
      expect(seriesOf().map((p) => p.date)).not.toContain('2026-08-02');
    });

    it('a row older than the bound is excluded', async () => {
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf().map((p) => p.date)).not.toContain('2026-01-01');
    });

    it('a canonical row is excluded — it would otherwise be its own bucket', async () => {
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf().map((p) => p.date)).not.toContain('2026-08-03');
    });

    it('a non-platform row is FETCHED and then skipped in memory', async () => {
      // Both halves matter. If the seam filtered it, the skip below would be
      // dead code reaching the same number by a different route.
      await trackPlan(WS, planWith('blendedRoas'));
      expect(actualsArgs().where.source).toBeUndefined();
      // GA4's 999 000 would have swamped the 5 Aug bucket.
      expect(seriesOf().find((p) => p.date === '2026-08-05').value).toBe(3);
    });

    it('two syncs on one calendar date SUM into one point (defect preserved)', async () => {
      // NOT a repair target for R3.6. Both 1 Aug rows land in a single bucket
      // because `date` is the sync stamp, and they are ADDED — 20 000 spend and
      // 40 000 revenue. Reading 3 here instead of 2 would mean only the first
      // row survived, which is what any reduction at the seam would produce.
      await trackPlan(WS, planWith('blendedRoas'));
      const aug1 = seriesOf().filter((p) => p.date === '2026-08-01');
      expect(aug1).toHaveLength(1);
      expect(aug1[0].value).toBe(2);     // 40 000 / 20 000, both rows
      expect(aug1[0].value).not.toBe(3); // 30 000 / 10 000, the first row alone
    });

    it('a calendar day without a sync gets no point (defect preserved)', async () => {
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf()).toHaveLength(2); // not 5, despite spanning 1–5 Aug
    });

    it('date ASC ordering reaches the series', async () => {
      // The table is stored 5 Aug first. Only the ORDER BY makes the series
      // chronological.
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf().map((p) => p.date)).toEqual(['2026-08-01', '2026-08-05']);
    });

    it('spend and conversions still produce the same blendedCac series', async () => {
      await trackPlan(WS, planWith('blendedCac'));
      expect(seriesOf()).toEqual([
        { date: '2026-08-01', value: 500 },   // 20 000 / 40, both rows summed
        { date: '2026-08-05', value: 2_500 }, // 20 000 / 8
      ]);
    });

    it('mer reads the same as blendedRoas, unchanged', async () => {
      await trackPlan(WS, planWith('mer'));
      expect(seriesOf()).toEqual(EXPECTED_ROAS_SERIES);
    });

    it('an empty population yields an empty series and no landing', async () => {
      useTable([]);
      const out = await trackPlan(WS, planWith());
      expect(out.goals[0].landing).toBeNull();
      expect(estimateLanding).not.toHaveBeenCalled();
      // No fallback: the empty result short-circuits before the entity scan, so
      // exactly ONE query was issued.
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ── isolation and failure ───────────────────────────────────────────────
  describe('isolation and failure', () => {
    it('cannot read across workspaces', async () => {
      await trackPlan(WS, planWith());
      expect(actualsArgs().where.workspaceId).toBe(WS);
    });

    it('degrades a failed read to an empty series — preserved', async () => {
      // The pre-migration read carried `.catch(() => [])`, so a database failure
      // has always produced a null landing rather than an exception, and never a
      // landing computed from a partial series.
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      const out = await trackPlan(WS, planWith());
      expect(out.goals[0].landing).toBeNull();
      expect(estimateLanding).not.toHaveBeenCalled();
    });

    it('the seam itself still refuses to swallow — the catch is Plan\'s own', async () => {
      const { selectOperationalSnapshots } = await import('../evidence/index.js');
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      await expect(selectOperationalSnapshots(WS, { select: PRE_MIGRATION_SELECT }))
        .rejects.toThrow('db down');
    });
  });
});

// ============================================================================
// R3.10 — the entity scan, the LAST direct operational read in the codebase
// ============================================================================
// A different question from every other consumer's: not "what did these entities
// measure" but "which entities has this workspace synced anything for at all".
// Hence one projected column, a collapse to one row per entity, and a cap of 50.
//
// The reduction is why the seam grew, and it is the growth that needed the most
// care: six earlier R3 PRs used `distinct` at the Evidence layer as a NEGATIVE
// CONTROL. Those controls still have to fail, which is why most of the seam-side
// tests for this option are about it being absent.
//
// OBSERVED DOWNSTREAM, not at the query. The scan's real output is the id list
// handed to gatherLeadingSignals, and from there the leadingSignals handed to
// estimateLanding — so that is where parity is asserted. The Prisma arguments
// are checked too, against a hand-written literal, because two of the mutations
// below cannot move an output.
// ============================================================================

// The pre-migration entity scan, reconstructed BY HAND from the diff.
const PRE_MIGRATION_SCAN = {
  where:    { workspaceId: WS, measurementWindow: PRE_MIGRATION_WINDOWS },
  select:   { entityId: true },
  distinct: ['entityId'],
  take:     50,
};

/** The SECOND findMany is the entity scan. */
const scanArgs = () => prisma.metricSnapshot.findMany.mock.calls[1][0];
/** The id list as it reaches the leading-signals gatherer — the read's real output. */
const scannedEntities = () => gatherLeadingSignals.mock.calls[0][1].entityIds;

describe('R3.10 — Plan\'s entity scan on the Evidence seam', () => {
  beforeEach(() => useTable(ENTITY_TABLE));

  describe('query parity with the pre-migration scan', () => {
    it('issues exactly the pre-migration query, key for key', async () => {
      await trackPlan(WS, planWith());
      const args = scanArgs();

      // Exhaustive on both levels: nothing added, nothing dropped, nothing renamed.
      expect(args.where).toEqual(PRE_MIGRATION_SCAN.where);
      expect(args.select).toEqual(PRE_MIGRATION_SCAN.select);
      expect(args.distinct).toEqual(PRE_MIGRATION_SCAN.distinct);
      expect(args.take).toBe(PRE_MIGRATION_SCAN.take);
      expect(Object.keys(args).sort()).toEqual(['distinct', 'select', 'take', 'where']);
      expect(Object.keys(args.where).sort()).toEqual(['measurementWindow', 'workspaceId']);
    });

    it('carries NO recency bound — an entity synced last quarter still counts', async () => {
      // This read has never had one, and the difference is not cosmetic: a goal
      // landing is projected over the entities a workspace HAS, not the ones it
      // happened to sync this month.
      await trackPlan(WS, planWith());
      expect(scanArgs().where.date).toBeUndefined();
      expect(scanArgs().where.windowStart).toBeUndefined();
      expect(scanArgs().where.windowEnd).toBeUndefined();
      expect(scannedEntities()).toContain('e-ancient');
    });

    it('asks for NO ordering — the key is absent, not null', async () => {
      await trackPlan(WS, planWith());
      expect(Object.prototype.hasOwnProperty.call(scanArgs(), 'orderBy')).toBe(false);
    });

    it('narrows by no level, no entity list and no source', async () => {
      await trackPlan(WS, planWith());
      expect(scanArgs().where.entityLevel).toBeUndefined();
      expect(scanArgs().where.entityId).toBeUndefined();
      expect(scanArgs().where.source).toBeUndefined();
    });
  });

  describe('entity population output parity', () => {
    it('produces the same entity list the direct query produced', async () => {
      await trackPlan(WS, planWith());
      expect(scannedEntities()).toEqual(EXPECTED_SCAN_ENTITIES);
    });

    it('collapses an entity with four eligible rows to ONE entry', async () => {
      await trackPlan(WS, planWith());
      expect(ENTITY_TABLE.filter((r) => r.entityId === 'e-base')).toHaveLength(3);
      expect(scannedEntities().filter((id) => id === 'e-base')).toHaveLength(1);
      // …and no id repeats anywhere: that is what `distinct` buys.
      expect(new Set(scannedEntities()).size).toBe(scannedEntities().length);
    });

    it('caps at 50 even though 63 entities are eligible', async () => {
      await trackPlan(WS, planWith());
      const eligible = new Set(ENTITY_TABLE
        .filter((r) => r.workspaceId === WS && r.measurementWindow !== 'CUMULATIVE_30D')
        .map((r) => r.entityId));
      expect(eligible.size).toBe(63);      // the cap is doing real work
      expect(scannedEntities()).toHaveLength(50);
    });

    it('another tenant\'s entity never enters the list', async () => {
      await trackPlan(WS, planWith());
      expect(scannedEntities()).not.toContain('e-otherws');
    });

    it('a canonical-only entity never enters the list', async () => {
      // e-canonical exists ONLY on a CUMULATIVE_30D row. It is a different
      // measurement, and Plan has never counted it as an entity it can project.
      await trackPlan(WS, planWith());
      expect(scannedEntities()).not.toContain('e-canonical');
    });

    it('the list reaches estimateLanding as real leading signals', async () => {
      // As far downstream as this read goes inside projectGoalLanding: the ids
      // become signals, and the signals become an argument of the projection.
      // The gatherer is derived from the ids here rather than stubbed flat, so
      // the population is observable at the engine boundary too.
      gatherLeadingSignals.mockImplementationOnce(async (_workspaceId, { entityIds }) =>
        entityIds.map((entityId) => ({ signal: 'creative_fatigue', entityId, confidence: 'LOW' })));

      const out = await trackPlan(WS, planWith());
      const signals = estimateLanding.mock.calls[0][0].leadingSignals;
      expect(signals.map((s) => s.entityId)).toEqual(EXPECTED_SCAN_ENTITIES);
      // …and the projection still lands, rather than being skipped.
      expect(out.goals[0].landing).not.toBeNull();
    });
  });

  describe('the seam gaining a reduction changed nothing else', () => {
    it('the entity scan is the ONLY read that asks for one', async () => {
      await trackPlan(WS, planWith());
      const withReduction = prisma.metricSnapshot.findMany.mock.calls
        .filter(([a]) => a.distinct !== undefined || a.take !== undefined);
      expect(withReduction).toHaveLength(1);
      expect(withReduction[0][0].select).toEqual({ entityId: true });
    });

    it('a read that does not ask cannot tell the option exists', async () => {
      await trackPlan(WS, planWith());
      expect(Object.keys(actualsArgs()).sort()).toEqual(['orderBy', 'select', 'where']);
    });
  });

  describe('isolation and failure', () => {
    it('cannot scan across workspaces', async () => {
      await trackPlan(WS, planWith());
      expect(scanArgs().where.workspaceId).toBe(WS);
    });

    it('degrades a failed scan to no leading signals — the catch is Plan\'s own', async () => {
      // The pre-migration scan carried `.catch(() => [])`, so a failure here has
      // always meant "no leading signals" rather than a thrown projection. The
      // series read succeeds, so the landing must still be computed — from an
      // empty signal list, exactly as before.
      let call = 0;
      prisma.metricSnapshot.findMany.mockImplementation((args) => {
        call += 1;
        return call === 1 ? fakeFindMany(ENTITY_TABLE)(args) : Promise.reject(new Error('db down'));
      });

      const out = await trackPlan(WS, planWith());
      expect(gatherLeadingSignals).toHaveBeenCalledWith(WS, expect.objectContaining({ entityIds: [] }));
      expect(estimateLanding).toHaveBeenCalled();
      expect(out.goals[0].landing).not.toBeNull();
    });
  });
});
