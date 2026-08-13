// ============================================================
// R3.6 — Plan actuals migrated onto the Evidence seam
// ============================================================
// A separate file from PlanService.test.js, which owns the planning contract.
// This one owns ONE read: the operational snapshot query behind
// buildActualsSeries(). PlanService's SECOND MetricSnapshot read — the
// distinct/take:50 entity-id scan in projectGoalLanding — is deliberately NOT
// migrated here, so this file also pins the partial state: exactly one seam read
// and exactly one remaining direct read, per goal.
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

const rowOf = (over) => ({
  workspaceId: WS, measurementWindow: 'ROLLING_WINDOW', source: 'META',
  spendMinor: 0, revenueMinor: 0, conversions: 0, ...over,
});

// Deliberately NOT in date order, so losing the ORDER BY changes the series the
// test reads rather than merely the arguments it inspects.
const TABLE = [
  // 5 Aug, the later bucket, placed first
  rowOf({ date: new Date('2026-08-05T09:00:00Z'), spendMinor: 20_000, revenueMinor: 40_000,
    conversions: 8, measurementWindow: 'LEGACY_UNKNOWN' }),
  // a non-platform source: FETCHED by the seam, skipped by Plan in memory
  rowOf({ date: new Date('2026-08-05T10:00:00Z'), source: 'GA4', spendMinor: 999_000,
    revenueMinor: 999_000, conversions: 999, measurementWindow: 'LEGACY_UNKNOWN' }),
  // 1 Aug, two syncs on ONE calendar date — they SUM into one bucket (the
  // sync-date bucketing this PR preserves rather than repairs)
  rowOf({ date: new Date('2026-08-01T09:00:00Z'), spendMinor: 10_000, revenueMinor: 30_000, conversions: 10 }),
  rowOf({ date: new Date('2026-08-01T15:00:00Z'), source: 'GOOGLE', spendMinor: 5_000,
    revenueMinor: 15_000, conversions: 5 }),
  // canonical: same window-day as a real bucket, excluded by the population
  rowOf({ date: new Date('2026-08-03T09:00:00Z'), measurementWindow: 'CUMULATIVE_30D',
    spendMinor: 777_000, revenueMinor: 777_000, conversions: 777 }),
  // older than any 60-day bound
  rowOf({ date: new Date('2026-01-01T09:00:00Z'), spendMinor: 888_000, revenueMinor: 888_000, conversions: 888 }),
  // another tenant, inside the window
  rowOf({ date: new Date('2026-08-02T09:00:00Z'), workspaceId: 'ws-other',
    spendMinor: 666_000, revenueMinor: 666_000, conversions: 666 }),
];

// 1 Aug bucket: spend 15 000, revenue 45 000, conv 15  → ROAS 3, CAC 1 000
// 5 Aug bucket: spend 20 000, revenue 40 000, conv  8  → ROAS 2, CAC 2 500
// 2/3/4 Aug: no point at all — a calendar day without a sync is absent, which is
// the defect being preserved, not a gap in the fixture.
const EXPECTED_ROAS_SERIES = [
  { date: '2026-08-01', value: 3 },
  { date: '2026-08-05', value: 2 },
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
    it('buildActualsSeries no longer queries MetricSnapshot directly', () => {
      // The actuals read is gone from the source; what remains is the ONE
      // un-migrated scan in projectGoalLanding, which R3.6 leaves alone.
      expect(SRC).toMatch(/selectOperationalSnapshots/);
      expect((SRC.match(/prisma\.metricSnapshot\.findMany/g) || []).length).toBe(1);
    });

    it('the remaining direct read is the entity scan, not the actuals read', () => {
      // Named explicitly so a future edit cannot migrate the wrong one and leave
      // this file passing.
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

    it('reads evidence once per goal, beside the ONE read still un-migrated', async () => {
      // A fallback would show as a third call. The count is the assertion,
      // because an empty second population returns the same shape as none.
      await trackPlan(WS, planWith());
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(2);
      expect(actualsArgs().select).toEqual(PRE_MIGRATION_SELECT);
      // …and the second call is unmistakably the un-migrated entity scan.
      const second = prisma.metricSnapshot.findMany.mock.calls[1][0];
      expect(second.select).toEqual({ entityId: true });
      expect(second.distinct).toEqual(['entityId']);
      expect(second.take).toBe(50);
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
      expect(seriesOf().find((p) => p.date === '2026-08-05').value).toBe(2);
    });

    it('two syncs on one calendar date SUM into one point (defect preserved)', async () => {
      // NOT a repair target for R3.6. 10 000 + 5 000 spend and 30 000 + 15 000
      // revenue land in a single 1 Aug bucket because `date` is the sync stamp.
      await trackPlan(WS, planWith('blendedRoas'));
      const aug1 = seriesOf().filter((p) => p.date === '2026-08-01');
      expect(aug1).toHaveLength(1);
      expect(aug1[0].value).toBe(3); // 45 000 / 15 000
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
        { date: '2026-08-01', value: 1_000 }, // 15 000 / 15
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
