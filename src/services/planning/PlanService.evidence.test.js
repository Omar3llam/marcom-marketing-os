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
// WHAT R4 CHANGED, AND WHAT IT DID NOT
// -------------------------------------
// R3.6 pinned the arithmetic exactly as it was — two syncs on one calendar date
// SUMMED into one point, and every entity level summed together — so that the
// repair, when it came, would be a visible change rather than a silent one.
// R4 is that repair, so those two assertions are INVERTED below rather than
// deleted. What replaced them:
//
//   • one entity level contributes (CAMPAIGN), because ACCOUNT is the sum of the
//     campaigns beneath it and adding both counts the same spend twice over;
//   • one winner per (entityId, source) per observation day, newest wins,
//     because two syncs are the same period re-measured, not more activity.
//
// STILL A DEFECT, STILL PINNED: the bucket key is `date.slice(0, 10)` where
// `date` is the SYNC timestamp. A day with no sync still gets no point, and a
// point is still a trailing-window reading rather than that day's activity.
// R4 did not claim otherwise, and the assertions below hold it to that.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// ── The controlled clock (B5-01S) ───────────────────────────────────────────
//
// This file used to write its evidence rows as calendar dates — 2026-08-01
// through 2026-08-05 — while the reader bounds them with `date >= now - 60d`.
// Absolute rows against a moving `now` is a staged expiry, not a fixture: the
// suite was green until 2026-09-30T09:00Z and then lost tests day by day as each
// row aged past the bound. Measured on this baseline, same bytes, clock only:
//
//   2026-08-28   53 passed             2026-10-02   38 passed | 15 failed
//   2026-09-30T08:00Z   53 passed      2026-10-04   20 passed | 33 failed
//   2026-09-30T10:00Z   48 passed |  5 failed       2027-08-30   19 | 34
//
// So the clock is pinned and every temporal fixture is derived from it. The
// idiom is the one canonicalFreshness.test.js and canonicalReadFailure.test.js
// already use; this file was the outlier. What is NOT done here: the lookback is
// unchanged, no assertion was weakened, and no expiring test was skipped.
const DAY = 86_400_000;
const RECENCY_DAYS = TEMPORAL.planActualsSyncRecencyDays;

/**
 * The default pinned instant. ARBITRARY BY DESIGN — nothing may depend on which
 * instant it is, and T3 proves that by running the same scenario at three
 * materially separated others.
 */
const REFERENCE_NOW = new Date('2026-08-30T12:00:00Z');

/** UTC midnight of whatever day the clock is currently pinned to. */
const refDay = () => Math.floor(Date.now() / DAY) * DAY;
/** UTC midnight `ageDays` before the reference day. */
const dayStart = (ageDays) => refDay() - ageDays * DAY;
/** An observation WRITTEN `ageDays` ago at `hour` UTC — a sync timestamp. */
const obs = (ageDays, hour) => new Date(dayStart(ageDays) + hour * 3_600_000);
/** The bucket label buildActualsSeries will produce for that day. */
const dayLabel = (ageDays) => new Date(dayStart(ageDays)).toISOString().slice(0, 10);

// The ages the fixture is built from, all derived from the real policy bound.
//
// The fixture spans SEVEN consecutive observation days and its oldest row sits
// at half the bound, so the whole span is inside by a margin wider than the span
// itself. That margin is deliberate: this suite's job is that the fixture stays
// temporally valid, not to own where the edge is (see the ownership census at
// T5). A fixture parked one day inside the limit would be a boundary test
// wearing a fixture's clothes, and would re-acquire the fragility B5-01S removed.
const OLDEST_AGE_DAYS = Math.floor(RECENCY_DAYS / 2);
const D1 = OLDEST_AGE_DAYS;          // the oldest bucket day
const D2 = OLDEST_AGE_DAYS - 1;      // the repair fixture's day
const D3 = OLDEST_AGE_DAYS - 2;      // canonical-only — no eligible point
const D4 = OLDEST_AGE_DAYS - 3;      // another tenant only — no eligible point
const D5 = OLDEST_AGE_DAYS - 4;      // the newest bucket day
const FILLER_AGE_DAYS = OLDEST_AGE_DAYS - 5;
const SPARE_AGE_DAYS  = OLDEST_AGE_DAYS - 6;  // used only by the null-value tables

/**
 * Far outside the bound — four times it, not one day past it. The exact edge is
 * owned elsewhere (T5); what this row is for is that a genuinely stale
 * observation is genuinely excluded, which stays true however the edge is drawn.
 */
const ANCIENT_AGE_DAYS = RECENCY_DAYS * 4;

/** A cron run reporting a trailing 90 days: the period a row MEASURES, which is
 *  not the day it lands in. Drives the windowStart rows on D2. */
const REPORTED_WINDOW_DAYS = 90;

// ── The literal expected query ──────────────────────────────────────────────
//
// Reconstructed BY HAND. Importing OPERATIONAL_WINDOW_FILTER, OPERATIONAL_ORDER_BY
// or ENTITY_LEVEL here would let the test agree with the implementation about
// what the population, the ordering and the grain are — which is exactly the
// agreement a parity test must withhold.
//
// `entityId` is R4's one projection change: the reduction keys on it, and the
// seam refuses an unprojected read. The rest is the pre-migration select.
const EXPECTED_SELECT = {
  date: true, entityId: true, spendMinor: true, revenueMinor: true, conversions: true, source: true,
};
const PRE_MIGRATION_WINDOWS = { in: ['LEGACY_UNKNOWN', 'ROLLING_WINDOW'] };
const PRE_MIGRATION_ORDER = { date: 'asc' };
const EXPECTED_LEVEL = 'CAMPAIGN';

// ── The fake table ──────────────────────────────────────────────────────────

// `entityId` is defaulted (R3.10) because the SECOND read projects it and
// nothing else. It is invisible to the actuals read — that read's projection
// does not include it — so the R3.6 fixture below is unchanged in effect.
// `entityLevel` is defaulted to CAMPAIGN (R4) because that is the grain the
// actuals read now asks for. Rows at other levels are added explicitly, in
// CROSS_LEVEL_TABLE, so the level narrowing has something real to exclude.
const rowOf = (over) => ({
  workspaceId: WS, measurementWindow: 'ROLLING_WINDOW', source: 'META',
  entityId: 'e-base', entityLevel: 'CAMPAIGN',
  spendMinor: 0, revenueMinor: 0, conversions: 0, ...over,
});

// Deliberately NOT in date order, so losing the ORDER BY changes the series the
// test reads rather than merely the arguments it inspects.
//
// B5-01S: a FUNCTION, not a literal. The rows have to be rebuilt every time the
// clock moves, or "derived from the reference instant" would only be true of the
// first instant the suite happens to run at.
const buildTable = () => [
  // D5, the later bucket, placed first
  rowOf({ date: obs(D5, 9), spendMinor: 20_000, revenueMinor: 60_000,
    conversions: 8, measurementWindow: 'LEGACY_UNKNOWN' }),
  // non-platform sources: FETCHED by the seam, skipped by Plan in memory. All
  // three of them, because "the actual-revenue sources" is a set, not one row —
  // GA4 alone would leave SHOPIFY and MANUAL untested against the same skip.
  rowOf({ date: obs(D5, 10), source: 'GA4', spendMinor: 999_000,
    revenueMinor: 999_000, conversions: 999, measurementWindow: 'LEGACY_UNKNOWN' }),
  rowOf({ date: obs(D5, 11), source: 'SHOPIFY', spendMinor: 0,
    revenueMinor: 888_000, conversions: 888, measurementWindow: 'LEGACY_UNKNOWN' }),
  rowOf({ date: obs(D5, 12), source: 'MANUAL', spendMinor: 0,
    revenueMinor: 777_000, conversions: 777, measurementWindow: 'LEGACY_UNKNOWN' }),
  // D1 — TWO DIFFERENT STREAMS on one day: one campaign's META row and
  // another campaign's GOOGLE row. They are independent measurements, so they
  // are still SUMMED. R4 changed how re-measurements combine, not how separate
  // campaigns do, and this bucket is the control that says so: its value is
  // identical before and after the repair.
  //
  // Their RATIOS differ on purpose. An earlier draft gave both rows the same
  // ROAS and the same CAC, which made "summed" and "first row wins" produce
  // identical values — so a `distinct: ['date']` mutation at the seam passed
  // every output assertion and was caught only in the query arguments. Two rows
  // that agree prove nothing about how they were combined.
  rowOf({ date: obs(D1, 9), spendMinor: 10_000, revenueMinor: 30_000, conversions: 10 }),
  rowOf({ date: obs(D1, 15), source: 'GOOGLE', entityId: 'e-second',
    spendMinor: 10_000, revenueMinor: 10_000, conversions: 30 }),
  // D2 — THE REPAIR FIXTURE. One stream (e-base|META) observed TWICE on one
  // day, with a third row from a different stream beside it.
  //
  // The two e-base rows also carry DIFFERENT measurement windows, deliberately:
  // a cron run reports a trailing 90 days and a manual Sync reports the whole
  // retention, and both are operational. Nothing stored ranks them, so the only
  // existing rule applies — the newest observation wins — and this fixture is
  // what fails if somebody invents a precedence rule instead.
  //
  // `roas` is stored on the winner and CONTRADICTS revenue/spend. It is not in
  // the projection, so reading it is impossible rather than merely wrong; the
  // assertion below pins that.
  rowOf({ date: obs(D2, 9), measurementWindow: 'LEGACY_UNKNOWN',
    windowStart: obs(D2 + REPORTED_WINDOW_DAYS, 0),
    spendMinor: 10_000, revenueMinor: 20_000, conversions: 4 }),
  rowOf({ date: obs(D2, 14), roas: 99,
    windowStart: obs(D2 + REPORTED_WINDOW_DAYS, 0),
    spendMinor: 40_000, revenueMinor: 160_000, conversions: 32 }),
  rowOf({ date: obs(D2, 11), source: 'GOOGLE', entityId: 'e-second',
    windowStart: obs(D2 + REPORTED_WINDOW_DAYS, 0),
    spendMinor: 10_000, revenueMinor: 40_000, conversions: 8 }),
  // canonical: same window-day as a real bucket, excluded by the population
  rowOf({ date: obs(D3, 9), measurementWindow: 'CUMULATIVE_30D',
    entityId: 'e-canonical', spendMinor: 777_000, revenueMinor: 777_000, conversions: 777 }),
  // older than the recency bound, by a wide margin. For the ACTUALS read that
  // makes it invisible; for the ENTITY scan, which has no recency bound, it is a
  // legitimate entity — which is what makes an accidental `since` observable
  // down there. Its AGE is what matters, so its age is what it is built from.
  rowOf({ date: obs(ANCIENT_AGE_DAYS, 9), entityId: 'e-ancient',
    spendMinor: 888_000, revenueMinor: 888_000, conversions: 888 }),
  // another tenant, inside the window. On D4, a day nothing else occupies, so
  // its leaking in would ADD a point rather than perturb one.
  rowOf({ date: obs(D4, 9), workspaceId: 'ws-other', entityId: 'e-otherws',
    spendMinor: 666_000, revenueMinor: 666_000, conversions: 666 }),
];

// ── The cross-level rows (R4) ───────────────────────────────────────────────
//
// The same D2 delivery as seen at the other three levels a platform sync
// lands. The ACCOUNT row is the SUM of that day's campaigns — that is what makes
// adding the levels together a double count rather than a rounding error.
//
// The AD row's ratios deliberately DIFFER from the campaigns'. With every level
// proportional, summing them all would produce the same ROAS as summing one, and
// the mutation that drops the level narrowing would pass every output assertion.
const buildCrossLevelTable = () => [
  ...TABLE,
  rowOf({ date: obs(D2, 14), entityId: 'e-acct', entityLevel: 'ACCOUNT',
    spendMinor: 50_000, revenueMinor: 200_000, conversions: 40 }),
  rowOf({ date: obs(D2, 14), entityId: 'e-adset', entityLevel: 'ADSET',
    spendMinor: 40_000, revenueMinor: 160_000, conversions: 32 }),
  rowOf({ date: obs(D2, 14), entityId: 'e-ad', entityLevel: 'AD',
    spendMinor: 40_000, revenueMinor: 100_000, conversions: 20 }),
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
const buildFillers = () => Array.from({ length: FILLER_COUNT }, (_, i) => rowOf({
  entityId: `e-${String(i).padStart(3, '0')}`,
  source:   'GA4',
  date:     new Date(dayStart(FILLER_AGE_DAYS) + (FILLER_COUNT - i) * 3_600_000),
}));

// Hand-derived from the pre-migration query semantics, NOT from the helper:
//   workspace ws-other        → excluded  (e-otherws)
//   CUMULATIVE_30D            → excluded  (e-canonical)
//   no recency bound          → e-ancient is IN
//   distinct: ['entityId']    → e-base's four rows collapse to one
//   take: 50, applied after   → the first 50 in storage order survive
// With no ORDER BY, "storage order" is genuinely unspecified in Postgres; the
// fake reproduces table order, which is the honest analogue. What the assertions
// below rest on is the CAP and the MEMBERSHIP SHIFTS, not the identity of row 50.
const buildExpectedScanEntities = () => [
  'e-base', 'e-second', 'e-ancient',
  ...FILLERS.slice(0, 47).map((r) => r.entityId),
];

// Hand-derived from the REPAIRED rule: one winner per (entityId, source) per
// observation day, at CAMPAIGN level only, summed across streams, ratios last.
//
// D1    — two streams, both winners: spend 20 000, rev 40 000, conv 40
//         → ROAS 2, CAC 500. Unchanged by R4, and that is the point of it.
// D2    — e-base|META observed twice; 14:00 supersedes 09:00. With e-second:
//         spend 50 000, rev 200 000, conv 40 → ROAS 4, CAC 1 250.
//         The values R4 replaced, kept here so the assertions can exclude them:
//           summed (the old behaviour)  → spend 60 000, rev 220 000, conv 44
//                                       → ROAS 3.666…, CAC 1 363.63…
//           first-row-wins (a reduction at the seam, date ASC)
//                                       → spend 20 000, rev  60 000, conv 12
//                                       → ROAS 3, CAC 1 666.66…
//           every level summed (no CAMPAIGN narrowing, CROSS_LEVEL_TABLE)
//                                       → spend 180 000, rev 660 000, conv 132
//                                       → ROAS 3.666…, CAC 1 363.63…
// D5    — one platform stream: spend 20 000, rev 60 000, conv 8 → ROAS 3, CAC 2 500.
// D3/D4: no point at all — a day without a sync of this workspace's own is
// absent, which is the bucketing defect R4 did NOT repair, not a gap in the
// fixture.
const buildExpectedRoasSeries = () => [
  { date: dayLabel(D1), value: 2 },
  { date: dayLabel(D2), value: 4 },
  { date: dayLabel(D5), value: 3 },
];

// ── The fixtures, rebuilt whenever the clock moves (B5-01S) ─────────────────
//
// `let`, not `const`, and assigned from the builders above. Nothing here is a
// calendar date any more: every row and every expected label is a function of
// whatever instant the clock is currently pinned to, so moving the clock moves
// the fixture with it instead of ageing it out from under the assertions.
let TABLE;
let CROSS_LEVEL_TABLE;
let FILLERS;
let ENTITY_TABLE;
let EXPECTED_SCAN_ENTITIES;
let EXPECTED_ROAS_SERIES;

function buildFixtures() {
  TABLE                  = buildTable();
  CROSS_LEVEL_TABLE      = buildCrossLevelTable();
  FILLERS                = buildFillers();
  ENTITY_TABLE           = [...TABLE, ...FILLERS];
  EXPECTED_SCAN_ENTITIES = buildExpectedScanEntities();
  EXPECTED_ROAS_SERIES   = buildExpectedRoasSeries();
}

const fakeFindMany = (table) => (args = {}) => {
  const w = args.where ?? {};
  let rows = table.filter((r) => (
    (w.workspaceId === undefined || r.workspaceId === w.workspaceId)
    && (w.measurementWindow === undefined || w.measurementWindow.in.includes(r.measurementWindow))
    && (w.entityId === undefined || w.entityId.in.includes(r.entityId))
    // R4: applied, not merely recorded — dropping the narrowing has to change
    // the rows the series is built from, not only the arguments it was asked for.
    && (w.entityLevel === undefined || r.entityLevel === w.entityLevel)
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

// The goal period BRACKETS the reference instant, opening on the fixture's
// oldest bucket day and closing tomorrow — which is what its 2026-08-01 →
// 2026-08-31 literal did against a wall clock in late August. That relationship
// is not decoration: estimateLanding derives pctOfPeriodElapsed from
// (now - periodStart) / (periodEnd - periodStart) and widens the landing band
// when the period is young. Pinning it keeps the projection's inputs fixed too,
// where before they drifted with every day that passed.
const planWith = (metric = 'blendedRoas') => ({
  id: 'p1',
  goals: [{
    id: 'g1', metric, comparator: 'GTE', targetValue: 2, spendCeilingMinor: null,
    periodStart: new Date(dayStart(D1)).toISOString(),
    periodEnd:   new Date(dayStart(-1)).toISOString(),
  }],
});

/** The FIRST findMany is buildActualsSeries; the second is the un-migrated scan. */
const actualsArgs = () => prisma.metricSnapshot.findMany.mock.calls[0][0];
/** The series buildActualsSeries produced, as it reaches the goal tracker. */
const seriesOf = () => estimateLanding.mock.calls[0][0].actuals;

/**
 * Pin the clock to `instant` and REBUILD every fixture from it.
 *
 * The rebuild is the half that matters. Pinning alone would only freeze the
 * suite at one calendar position; rebuilding is what makes the same bytes mean
 * the same thing at any position, which is what T3 measures.
 */
const at = (instant) => {
  vi.setSystemTime(instant);
  buildFixtures();
  useTable();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  at(REFERENCE_NOW);
});

afterEach(() => { vi.useRealTimers(); });

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
  describe('query parity with the expected read', () => {
    it('issues exactly the expected query, key for key', async () => {
      const before = Date.now();
      await trackPlan(WS, planWith());
      const after = Date.now();
      const args = actualsArgs();

      expect(args.where.workspaceId).toBe(WS);
      expect(args.where.measurementWindow).toEqual(PRE_MIGRATION_WINDOWS);
      expect(args.where.entityLevel).toBe(EXPECTED_LEVEL);
      expect(args.select).toEqual(EXPECTED_SELECT);
      expect(args.orderBy).toEqual(PRE_MIGRATION_ORDER);

      const days = TEMPORAL.planActualsSyncRecencyDays;
      const gte = args.where.date.gte.getTime();
      expect(gte).toBeGreaterThanOrEqual(before - days * 86_400_000);
      expect(gte).toBeLessThanOrEqual(after - days * 86_400_000);

      // Nothing added, nothing dropped, at either level. R4 added exactly one
      // predicate and exactly one projected column; this is what holds it to that.
      expect(Object.keys(args.where).sort()).toEqual(['date', 'entityLevel', 'measurementWindow', 'workspaceId']);
      expect(Object.keys(args).sort()).toEqual(['orderBy', 'select', 'where']);
    });

    it('asks the SEAM for the level — it does not filter the grain in memory', async () => {
      // The distinction is load-bearing. `entityLevel` is a property of which
      // rows the question is about, so it belongs in the query the way
      // RevenueCsv's does; the SOURCE set is Plan's own semantics and stays in
      // memory. A repair that narrowed the level in the loop instead would read
      // every ad row in the workspace to throw it away.
      await trackPlan(WS, planWith());
      expect(actualsArgs().where.entityLevel).toBe('CAMPAIGN');
      expect(SRC).not.toMatch(/entityLevel === /);
      expect(SRC).not.toMatch(/r\.entityLevel/);
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
      // Level-scoped is not entity-scoped: every campaign in the workspace still
      // contributes. R4 picked a grain, it did not pick a subset of campaigns.
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
      expect(actualsArgs().select).toEqual(EXPECTED_SELECT);
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
  describe('actuals series output', () => {
    it('produces the repaired observation-day series, point for point', async () => {
      // The whole series, exhaustively: dates, values and length together. Every
      // one of the four wrong answers enumerated beside EXPECTED_ROAS_SERIES
      // differs from this on at least one point.
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf()).toEqual(EXPECTED_ROAS_SERIES);
      expect(seriesOf()).toHaveLength(3);
    });

    it('another tenant\'s rows never enter a bucket', async () => {
      await trackPlan(WS, planWith('blendedRoas'));
      // ws-other's row sits alone on D4, so leaking would ADD a point.
      expect(seriesOf().map((p) => p.date)).not.toContain(dayLabel(D4));
    });

    it('a row older than the bound is excluded', async () => {
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf().map((p) => p.date)).not.toContain(dayLabel(ANCIENT_AGE_DAYS));
    });

    it('a canonical row is excluded — it would otherwise be its own bucket', async () => {
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf().map((p) => p.date)).not.toContain(dayLabel(D3));
    });

    it('the actual-revenue sources are FETCHED and then skipped in memory', async () => {
      // Both halves matter. If the seam filtered them, the skip in the loop
      // would be dead code reaching the same number by a different route.
      await trackPlan(WS, planWith('blendedRoas'));
      expect(actualsArgs().where.source).toBeUndefined();
      // GA4, SHOPIFY and MANUAL all sit on D5 and would have swamped it —
      // and two of them carry ZERO spend, so admitting them would also drag the
      // denominator the wrong way rather than merely inflating both halves.
      expect(seriesOf().find((p) => p.date === dayLabel(D5)).value).toBe(3);
    });

    it('two observations of ONE stream on one day do not sum — the newest wins', async () => {
      // THE R4 REPAIR, inverted from the assertion R3.6 pinned. e-base|META was
      // observed at 09:00 and again at 14:00 on D2: the same period measured
      // twice, not twice the activity. 14:00 supersedes 09:00, and only then is
      // e-second's independent stream added.
      await trackPlan(WS, planWith('blendedRoas'));
      const d2Point = seriesOf().filter((p) => p.date === dayLabel(D2));
      expect(d2Point).toHaveLength(1);
      expect(d2Point[0].value).toBe(4);                    // 200 000 / 50 000
      expect(d2Point[0].value).not.toBeCloseTo(11 / 3, 6); // 220 000 / 60 000, both added
      expect(d2Point[0].value).not.toBe(3);                // 60 000 / 20 000, 09:00 alone
    });

    it('the winner is chosen across DIFFERENT measurement windows, by recency alone', async () => {
      // The 09:00 row and the 14:00 row report different periods — a trailing 90
      // days and the account's whole retention. Both are operational, nothing
      // stored ranks them, and the repair invents no precedence: the later
      // observation wins because it is later. If a window rule had been added,
      // the value here would stop being the 14:00 row's.
      await trackPlan(WS, planWith('blendedRoas'));
      const winner = TABLE.find((r) => r.date.getTime() === obs(D2, 14).getTime() && r.source === 'META');
      const loser  = TABLE.find((r) => r.date.getTime() === obs(D2, 9).getTime());
      expect(winner.measurementWindow).not.toBe(loser.measurementWindow); // genuinely mixed
      expect(seriesOf().find((p) => p.date === dayLabel(D2)).value)
        .toBe((winner.revenueMinor + 40_000) / (winner.spendMinor + 10_000));
    });

    it('two DIFFERENT streams on one day are still summed', async () => {
      // The other half of the rule, and the reason this is a repair rather than
      // a blanket deduplication: separate campaigns are independent
      // measurements. D1 reads exactly what it read before R4.
      await trackPlan(WS, planWith('blendedRoas'));
      const d1Point = seriesOf().filter((p) => p.date === dayLabel(D1));
      expect(d1Point).toHaveLength(1);
      expect(d1Point[0].value).toBe(2);     // 40 000 / 20 000, both streams
      expect(d1Point[0].value).not.toBe(3); // 30 000 / 10 000, one stream alone
    });

    it('a stored ratio is never read — the value is derived from the counts', async () => {
      // The D2 winner carries `roas: 99`. It is not in the projection, so it
      // is not merely ignored — it never arrives. Both halves are asserted,
      // because a projection that started returning it is the change that would
      // make "ignored" the only thing standing between it and the series.
      await trackPlan(WS, planWith('blendedRoas'));
      expect(actualsArgs().select.roas).toBeUndefined();
      expect(seriesOf().find((p) => p.date === dayLabel(D2)).value).toBe(4);
      expect(seriesOf().map((p) => p.value)).not.toContain(99);
    });

    it('a calendar day without a sync gets no point (defect NOT repaired)', async () => {
      // R4 deliberately left this alone. D3 and D4 have no eligible platform
      // observation of this workspace's own, and nothing is interpolated to fill
      // them — a series with 5 points here would mean days were invented.
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf()).toHaveLength(3); // not 5, despite spanning D1–D5
      expect(seriesOf().map((p) => p.date)).not.toContain(dayLabel(D3));
      expect(seriesOf().map((p) => p.date)).not.toContain(dayLabel(D4));
    });

    it('date ASC ordering reaches the series', async () => {
      // The table is stored D5 first. Only the ORDER BY makes the series
      // chronological. The reduction does NOT lean on it — see the test below.
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf().map((p) => p.date)).toEqual([dayLabel(D1), dayLabel(D2), dayLabel(D5)]);
    });

    it('the newest-wins rule survives the rows arriving in the worst order', async () => {
      // Order-independence, proven rather than asserted. This fake applies every
      // predicate but IGNORES the ORDER BY and returns the table reversed, which
      // is what a lost ordering looks like from in here. `newest wins` is
      // unaffected. A reduction written as "the last row I saw wins" agrees with
      // it under the ASC ordering the seam actually applies — the two are
      // indistinguishable in the test above — and reads the 09:00 row here,
      // giving 3 instead of 4.
      prisma.metricSnapshot.findMany.mockImplementation((args) =>
        fakeFindMany([...TABLE].reverse())({ ...args, orderBy: undefined }));
      await trackPlan(WS, planWith('blendedRoas'));
      expect(seriesOf().find((p) => p.date === dayLabel(D2)).value).toBe(4);
    });

    it('spend and conversions produce the matching blendedCac series', async () => {
      await trackPlan(WS, planWith('blendedCac'));
      expect(seriesOf()).toEqual([
        { date: dayLabel(D1), value: 500 },   // 20 000 / 40, two streams
        { date: dayLabel(D2), value: 1_250 }, // 50 000 / 40, newest per stream
        { date: dayLabel(D5), value: 2_500 }, // 20 000 / 8
      ]);
    });

    it('mer reads the same as blendedRoas — its semantics are NOT repaired here', async () => {
      // `mer` computes identically to `blendedRoas` over platform rows only, so
      // it excludes exactly the actual revenue a marketing-efficiency ratio is
      // supposed to include. Real, known, and deliberately out of R4's scope:
      // this pins it unchanged so the day it is fixed is a visible change.
      await trackPlan(WS, planWith('mer'));
      expect(seriesOf()).toEqual(EXPECTED_ROAS_SERIES);
    });

    // ── the cross-level double count (R4) ─────────────────────────────────
    describe('overlapping entity levels', () => {
      beforeEach(() => useTable(CROSS_LEVEL_TABLE));

      it('only CAMPAIGN rows contribute — the series is unmoved by the other levels', async () => {
        // The strongest form of the claim: the SAME delivery, now also present
        // as an ACCOUNT rollup, an ADSET row and an AD row, changes nothing at
        // all. Not the D2 value, not the day count, not any other point.
        await trackPlan(WS, planWith('blendedRoas'));
        expect(seriesOf()).toEqual(EXPECTED_ROAS_SERIES);
      });

      it('the ACCOUNT rollup is the sum of the campaigns — which is why adding them is a double count', async () => {
        // Not an assertion about the code: an assertion about the fixture, so
        // the test below is measuring the real defect rather than an arbitrary
        // number. The rollup equals D2's repaired campaign totals exactly.
        const acct = CROSS_LEVEL_TABLE.find((r) => r.entityId === 'e-acct');
        expect(acct.spendMinor).toBe(50_000);
        expect(acct.revenueMinor).toBe(200_000);
        await trackPlan(WS, planWith('blendedRoas'));
        expect(seriesOf().find((p) => p.date === dayLabel(D2)).value)
          .toBe(acct.revenueMinor / acct.spendMinor);
      });

      it('the value is not what summing every level would give', async () => {
        // 180 000 spend against 660 000 revenue — the answer before R4, spelled
        // out so the assertion excludes a specific wrong number rather than
        // merely confirming a right one.
        await trackPlan(WS, planWith('blendedRoas'));
        expect(seriesOf().find((p) => p.date === dayLabel(D2)).value)
          .not.toBeCloseTo(660_000 / 180_000, 6);
      });

      it('and the same holds for blendedCac', async () => {
        await trackPlan(WS, planWith('blendedCac'));
        const d2Value = seriesOf().find((p) => p.date === dayLabel(D2)).value;
        expect(d2Value).toBe(1_250);                       // 50 000 / 40, campaigns only
        expect(d2Value).not.toBeCloseTo(180_000 / 132, 6); // every level summed
      });
    });

    // ── null and missing values (R4) ──────────────────────────────────────
    describe('null and missing values', () => {
      it('a null spend contributes 0 and fabricates no point', async () => {
        // The day's only row measures nothing. `?? 0` keeps the arithmetic from
        // going NaN, and the `spendMinor > 0` guard then suppresses the point
        // rather than emitting a ROAS of 0 the data does not support.
        useTable([rowOf({ date: obs(SPARE_AGE_DAYS, 9), spendMinor: null, revenueMinor: null, conversions: null })]);
        const out = await trackPlan(WS, planWith('blendedRoas'));
        expect(estimateLanding).not.toHaveBeenCalled();
        expect(out.goals[0].landing).toBeNull();
      });

      it('a null spend beside a real stream neither breaks nor inflates the day', async () => {
        useTable([
          rowOf({ date: obs(SPARE_AGE_DAYS, 9), spendMinor: null, revenueMinor: null, conversions: null }),
          rowOf({ date: obs(SPARE_AGE_DAYS, 10), entityId: 'e-second',
            spendMinor: 10_000, revenueMinor: 30_000, conversions: 5 }),
        ]);
        await trackPlan(WS, planWith('blendedRoas'));
        expect(seriesOf()).toEqual([{ date: dayLabel(SPARE_AGE_DAYS), value: 3 }]);
      });

      it('windowStart is neither read nor projected — the bucket is the observation day', async () => {
        // The D2 rows carry a windowStart 90 DAYS EARLIER — a cron run reporting
        // a trailing quarter. If the bucket key were the reported period rather
        // than the observation, they would land on the day that window OPENED,
        // three months back. The column is not even projected, so the series is the
        // proof and the projection assertion is the reason it cannot drift.
        await trackPlan(WS, planWith('blendedRoas'));
        expect(actualsArgs().select.windowStart).toBeUndefined();
        expect(actualsArgs().select.windowEnd).toBeUndefined();
        expect(seriesOf().map((p) => p.date)).not.toContain(dayLabel(D2 + REPORTED_WINDOW_DAYS));
        expect(seriesOf().map((p) => p.date)).toContain(dayLabel(D2));
      });

      it('a null observation date yields no point, and no fabricated one', async () => {
        // UNREACHABLE IN PRODUCTION — MetricSnapshot.date is NOT NULL — so this
        // pins the choice rather than a live path. Such a row never even reaches
        // the loop: the recency predicate is `date >= since`, and NULL compared
        // to anything is not true, in Postgres and in the fake alike. What the
        // assertion is really for is the answer that follows — no bucket is
        // invented for it, from today's date or from anything else, so the goal
        // simply has no actuals rather than a fabricated day.
        useTable([rowOf({ date: null, spendMinor: 10_000, revenueMinor: 30_000, conversions: 5 })]);
        const out = await trackPlan(WS, planWith('blendedRoas'));
        expect(out.goals[0].landing).toBeNull();
        expect(estimateLanding).not.toHaveBeenCalled();
      });
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
      await expect(selectOperationalSnapshots(WS, { select: EXPECTED_SELECT }))
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

    it('collapses an entity with many eligible rows to ONE entry', async () => {
      // The count grew with R4's fixture (more sources, and a same-day
      // re-observation). What it is asserting has not: the scan is a set of
      // entities, however many rows each one has.
      await trackPlan(WS, planWith());
      expect(ENTITY_TABLE.filter((r) => r.entityId === 'e-base')).toHaveLength(7);
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

// ============================================================================
// B5-01S — clock safety
// ============================================================================
// Everything above describes timeless behaviour: how a day's observations
// combine, which rows a tenant may see, what a stale row does. None of it is
// about the calendar, and none of it should change depending on which day the
// suite runs. It did.
//
// These tests are the ratchet on that. They do NOT re-own the evidence policy —
// see the census at T5 — they own the one property this file is responsible for:
// its own fixture stays temporally valid, forever, without anyone maintaining it.
// ============================================================================

/** Whole UTC days between the pinned reference day and the day a row landed in. */
const ageInDays = (date) => (refDay() - Math.floor(new Date(date).getTime() / DAY) * DAY) / DAY;

/**
 * Burn REAL wall-clock time and report how much was burnt.
 *
 * `process.uptime()` is the real-time source vitest's fake timers leave alone.
 * MEASURED, not assumed: under `vi.useFakeTimers()` a 20 000 000-iteration loop
 * moved `process.uptime` by 25.5 ms while `Date.now`, `performance.now` AND
 * `process.hrtime` all reported a delta of exactly 0. hrtime was the first
 * choice here and is faked — the premise check below is what caught it.
 *
 * `sink` is module-level AND returned so V8 cannot eliminate the loop, and the
 * guard bounds the worst case at ~4e8 iterations if the asymmetry ever
 * disappears, so the test fails on its own premise instead of hanging the suite.
 */
let sink = 0;
const spinRealMs = (ms) => {
  const start = process.uptime();
  const elapsed = () => (process.uptime() - start) * 1000;
  for (let guard = 0; guard < 2_000 && elapsed() < ms; guard += 1) {
    for (let i = 0; i < 200_000; i += 1) sink += i % 7;
  }
  return { elapsedMs: elapsed(), work: sink };
};

describe('B5-01S — the calendar cannot change whether this file is correct', () => {
  // ── T1 · the intended path, under the controlled clock ───────────────────
  it('T1 — the intended evidence path is green at the pinned reference instant', async () => {
    await trackPlan(WS, planWith('blendedRoas'));
    expect(seriesOf()).toEqual(EXPECTED_ROAS_SERIES);
    expect(seriesOf().map((p) => p.value)).toEqual([2, 4, 3]);
  });

  // ── T2 · the AGE, not the date ───────────────────────────────────────────
  it('T2 — every observation is exactly the age it is declared to be', () => {
    // Rows are located by their BUSINESS identity — the tenant, the canonical
    // window, the contradictory stored ratio — and only then is their age
    // asserted. Finding a row by the timestamp the helper built and then
    // checking that timestamp would prove nothing but that `===` works.
    const cases = [
      [D1,               TABLE.find((r) => r.source === 'GOOGLE' && r.conversions === 30)],
      [D2,               TABLE.find((r) => r.roas === 99)],
      [D3,               TABLE.find((r) => r.entityId === 'e-canonical')],
      [D4,               TABLE.find((r) => r.entityId === 'e-otherws')],
      [D5,               TABLE.find((r) => r.source === 'MANUAL')],
      [ANCIENT_AGE_DAYS, TABLE.find((r) => r.entityId === 'e-ancient')],
    ];
    for (const [intendedAge, row] of cases) {
      expect(row, `no fixture row for age ${intendedAge}`).toBeTruthy();
      expect(ageInDays(row.date)).toBe(intendedAge);
    }

    // …and the ages mean what the policy says they mean. This is the assertion
    // that fails the day someone edits an age past the bound: the fixture is
    // inside by construction, and the one stale row is outside by construction.
    for (const row of TABLE.filter((r) => r.entityId !== 'e-ancient')) {
      expect(ageInDays(row.date)).toBeLessThan(RECENCY_DAYS);
    }
    expect(ageInDays(TABLE.find((r) => r.entityId === 'e-ancient').date))
      .toBeGreaterThan(RECENCY_DAYS);
  });

  // ── T3 · the same bytes at materially separated instants ─────────────────
  //
  // Two years apart at the extremes, which is the point: nothing about the
  // fixture, the bucket labels or the goal period may depend on the era. The
  // VALUE assertion is the clock-independent core — a series rebuilt at a
  // different instant still reads 2, 4, 3, because those come from the counts.
  const INSTANTS = ['2026-01-15T00:00:00Z', '2026-08-25T09:00:00Z', '2030-07-15T18:00:00Z'];

  it.each(INSTANTS)('T3 — the actuals series is identical at %s', async (instant) => {
    at(instant);
    await trackPlan(WS, planWith('blendedRoas'));
    expect(seriesOf().map((p) => p.value)).toEqual([2, 4, 3]);
    expect(seriesOf()).toHaveLength(3);
    expect(seriesOf()).toEqual(EXPECTED_ROAS_SERIES);
  });

  it.each(INSTANTS)('T3 — the entity scan is identical at %s', async (instant) => {
    at(instant);
    useTable(ENTITY_TABLE);
    await trackPlan(WS, planWith());
    expect(scannedEntities()).toEqual(EXPECTED_SCAN_ENTITIES);
    expect(scannedEntities()).toHaveLength(50);
  });

  it('T3b — the clock is pinned, not merely sampled once', async () => {
    // WHY THIS EXISTS. Every fixture above is derived from `Date.now()`, so if
    // the pinning were deleted the fixtures would simply self-adjust to the real
    // clock and the whole suite would still be green — the safety property would
    // be true by luck rather than by construction, and nothing would say so.
    // This is the assertion that fails when the pin goes away.
    expect(Date.now(), 'the clock is not pinned to the reference instant')
      .toBe(REFERENCE_NOW.getTime());

    // …and it does not merely start there: real milliseconds pass and the
    // frozen clock does not notice, across a synchronous burn and an await.
    const t0 = Date.now();
    const { elapsedMs, work } = spinRealMs(25);
    expect(work, 'the burn loop was optimised away — it proves nothing').toBeGreaterThan(0);
    expect(elapsedMs, 'the guard must burn REAL time, or it proves nothing').toBeGreaterThanOrEqual(25);
    expect(Date.now(), 'the system clock advanced during a test — it is not pinned').toBe(t0);
    await Promise.resolve();
    expect(Date.now()).toBe(t0);
  });

  // ── T4 · stale is still stale ────────────────────────────────────────────
  it('T4 — a genuinely stale observation is still excluded, not made fresh by freezing time', async () => {
    await trackPlan(WS, planWith('blendedRoas'));
    const ancient = TABLE.find((r) => r.entityId === 'e-ancient');
    expect(ageInDays(ancient.date)).toBeGreaterThan(RECENCY_DAYS);
    expect(seriesOf().map((p) => p.date)).not.toContain(dayLabel(ANCIENT_AGE_DAYS));
    expect(seriesOf()).toHaveLength(3);
  });

  it('T4b — a population of nothing BUT stale observations still yields no landing', async () => {
    // The strong form. If pinning had quietly widened the window — or if the
    // fixture had stopped interacting with the real bound at all — this row
    // would come back and produce a projection out of evidence too old to use.
    useTable([rowOf({
      date: obs(ANCIENT_AGE_DAYS, 9), spendMinor: 10_000, revenueMinor: 30_000, conversions: 5,
    })]);
    const out = await trackPlan(WS, planWith('blendedRoas'));
    expect(out.goals[0].landing).toBeNull();
    expect(estimateLanding).not.toHaveBeenCalled();
  });

  // ── T5 · boundary ownership ──────────────────────────────────────────────
  //
  // THE CENSUS (B5-01S §5), recorded rather than summarised:
  //
  //   the VALUE 60, and its env-var precedence
  //       → src/config/temporal.test.js. Named there, asserted there.
  //   the SHAPE of the bound — that it is `date >= since`, inclusive, and never
  //   windowStart/windowEnd
  //       → src/services/evidence/operationalEvidence.test.js
  //         ('bounds `date` — the SYNC timestamp — and never windowStart/windowEnd').
  //   the exact EDGE — a row at age == 60 vs age == 61
  //       → NOBODY, in the behavioural sense: `gte` is Prisma's, and no suite
  //         drives a row across it. Recorded as a gap; NOT closed here, because
  //         a fixture parked on the edge is precisely the fragility this slice
  //         removed, and a second owner of the evidence policy is what §5
  //         forbids. It belongs to whichever slice takes evidence freshness.
  //
  // What this file owns, and has always owned, is the DERIVATION: that Plan asks
  // for `now - planActualsSyncRecencyDays`. Pinning the clock lets that be
  // asserted exactly instead of as a range — a strengthening, and the range
  // assertions above are kept unchanged beside it.
  it('T5 — the `since` this file owns is exactly now minus the configured bound', async () => {
    await trackPlan(WS, planWith());
    expect(actualsArgs().where.date.gte.getTime()).toBe(Date.now() - RECENCY_DAYS * DAY);
  });

  it('T5b — no fixture row sits near the boundary, so this suite cannot become its second owner', () => {
    // A margin, not an edge. If a future edit moves a row to age 59 or 61 to
    // "also test the boundary", this fails and says where that test belongs.
    const margins = TABLE.map((r) => Math.abs(ageInDays(r.date) - RECENCY_DAYS));
    expect(Math.min(...margins)).toBeGreaterThanOrEqual(RECENCY_DAYS / 4);
  });
});
