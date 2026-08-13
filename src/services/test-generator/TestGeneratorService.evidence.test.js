// ============================================================
// R3.7 — TestGenerator migrated onto the Evidence seam
// ============================================================
// THE FIRST CONSUMER WITH NO EXISTING SERVICE TEST. Only the pure engine had
// one; `buildEntityInputs` and the query it feeds on had no direct coverage at
// all, and AgenticLoopService mocks getWeeklyAgenda wholesale. So this file
// carries the whole burden of proving the migration rather than leaning on a
// suite that was already watching.
//
// THE ONE INTENTIONAL CHANGE
// --------------------------
// This read was select-less. Prisma returned every column of every row in the
// recency window, including the `actionMetrics` JSON funnel blob nobody here
// opens. The seam refuses an unprojected read by contract, so the migration
// names the ELEVEN fields buildEntityInputs actually consumes. Everything else —
// population, temporal bound, aggregation, source eligibility, ordering, error
// behaviour, output shape — is preserved, and each of those is asserted below
// rather than asserted about.
//
// A FAKE TABLE, NOT A CANNED ROW LIST
// ------------------------------------
// findMany here APPLIES the predicates, ordering, distinct and take it is
// handed, AND the projection. The projection matters most: a field dropped from
// `select` genuinely disappears from the row, so "is this field still needed?"
// is answered by the OUTPUT, not by reading the select clause back.
//
// THE FIXTURE IS BUILT SO AGGREGATION IS VISIBLE
// -----------------------------------------------
// The two live rows for camp-1 have deliberately different ratios, and their
// per-row `ctr`/`roas` columns disagree with the recomputed aggregate. Every
// aggregate-sensitive output differs from what "first row wins" would give:
//
//   ctr   2.5   (first row alone: 1.0,  stored columns: 1.0 / 3.0)
//   roas  3.5   (first row alone: 2.0,  stored columns: 2.0 / 4.0)
//   cpa   20    (first row alone: 25)
//   spend 40 000 (first row alone: 10 000)
//
// so no reduction at the seam can pass by arithmetic coincidence.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Wrapped, not replaced: the real engine still runs, and the spy is how
// buildEntityInputs' output becomes observable. getWeeklyAgenda returns the
// ranked agenda, not the entity inputs, so asserting on the agenda would put
// the generator's ranking between the test and the thing being migrated.
vi.mock('./testGeneratorEngine.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, generateAgenda: vi.fn(orig.generateAgenda) };
});
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    metricSnapshot:      { findMany: vi.fn() },
    account:             { findMany: vi.fn() },
    decision:            { findMany: vi.fn() },
    decisionMemoryEntry: { findMany: vi.fn() },
    workspace:           { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { generateAgenda } from './testGeneratorEngine.js';
import { getWeeklyAgenda } from './TestGeneratorService.js';
import { TEMPORAL } from '../../config/temporal.js';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'TestGeneratorService.js'),
  'utf8',
);

const WS = 'ws-testgen';

// ── The contract, written by hand ───────────────────────────────────────────
//
// The window allow-list is spelled out literally rather than imported: letting
// the test agree with the implementation about what "operational" means is
// exactly the agreement a parity test must withhold.
const OPERATIONAL_WINDOWS = { in: ['LEGACY_UNKNOWN', 'ROLLING_WINDOW'] };

/** The eleven fields buildEntityInputs consumes. Nothing more, nothing less. */
const REQUIRED_PROJECTION = {
  source: true, entityId: true, entityLevel: true, currency: true,
  spendMinor: true, revenueMinor: true, impressions: true, clicks: true,
  conversions: true, frequency: true, date: true,
};

// ── The fake table ──────────────────────────────────────────────────────────

// Relative to now, so a fixture cannot quietly age out of the 14-day bound.
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

const rowOf = (over) => ({
  workspaceId: WS, measurementWindow: 'ROLLING_WINDOW', source: 'META',
  entityLevel: 'ADSET', currency: 'EGP',
  spendMinor: 0, revenueMinor: 0, impressions: 0, clicks: 0, conversions: 0,
  frequency: null,
  // Columns the consumer does NOT read. They are present in the table so the
  // projection has something to drop, and so a test that accidentally depended
  // on one would notice.
  ctr: null, roas: null, reach: 999, cpaMinor: 999, actionMetrics: { purchase: 999 },
  dailyBudgetMinor: 999, granularity: 'DAILY', windowStart: null, windowEnd: null,
  ...over,
});

const TABLE = [
  // camp-1 — the later row first, so nothing depends on table order
  rowOf({ entityId: 'camp-1', date: daysAgo(2),
    impressions: 3_000, clicks: 90, spendMinor: 30_000, revenueMinor: 120_000,
    conversions: 16, frequency: 5.0, ctr: 3.0, roas: 4.0 }),
  rowOf({ entityId: 'camp-1', date: daysAgo(5),
    impressions: 1_000, clicks: 10, spendMinor: 10_000, revenueMinor: 20_000,
    conversions: 4, frequency: 2.0, ctr: 1.0, roas: 2.0 }),
  // acct-1 — the ONE entity whose metadata lookup resolves
  rowOf({ entityId: 'acct-1', date: daysAgo(3),
    impressions: 500, clicks: 25, spendMinor: 5_000, revenueMinor: 5_000,
    conversions: 2, frequency: 1.5 }),
  // fetched by the seam, skipped by PLATFORM_SOURCES in memory
  rowOf({ entityId: 'camp-1', date: daysAgo(1), source: 'GA4',
    impressions: 999_000, clicks: 999_000, spendMinor: 999_000,
    revenueMinor: 999_000, conversions: 999, frequency: 99.0 }),
  // canonical: same entity, inside the window, excluded by the population
  rowOf({ entityId: 'camp-1', date: daysAgo(2), measurementWindow: 'CUMULATIVE_30D',
    impressions: 777_000, clicks: 777, spendMinor: 777_000, revenueMinor: 777_000,
    conversions: 777, frequency: 77.0 }),
  // older than any 14-day bound
  rowOf({ entityId: 'camp-1', date: daysAgo(400),
    impressions: 888_000, clicks: 888, spendMinor: 888_000, revenueMinor: 888_000,
    conversions: 888, frequency: 88.0 }),
  // another tenant, same entity id, inside the window
  rowOf({ entityId: 'camp-1', date: daysAgo(1), workspaceId: 'ws-other',
    impressions: 666_000, clicks: 666, spendMinor: 666_000, revenueMinor: 666_000,
    conversions: 666, frequency: 66.0 }),
];

// camp-1, aggregated over its two eligible rows:
//   impressions 4 000 · clicks 100 · spend 40 000 · revenue 140 000 · conv 20
//   ctr  = 100 / 4 000 × 100        = 2.5
//   roas = 140 000 / 40 000         = 3.5
//   cpa  = fromMinor(40 000, EGP) / 20 = 400 / 20 = 20
//   frequency = 5.0, the row with the LATEST date
const EXPECTED_CAMP1 = {
  ctr: 2.5, roas: 3.5, frequency: 5.0, cpa: 20, conversions: 20, spendMinor: 40_000,
};

const fakeFindMany = (table) => (args = {}) => {
  const w = args.where ?? {};
  let rows = table.filter((r) => (
    (w.workspaceId === undefined || r.workspaceId === w.workspaceId)
    && (w.measurementWindow === undefined || w.measurementWindow.in.includes(r.measurementWindow))
    && (w.entityId === undefined || w.entityId.in.includes(r.entityId))
    && (w.source === undefined || w.source.in.includes(r.source))
    && (w.date === undefined || r.date >= w.date.gte)
  ));
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
  // The projection is APPLIED. A field missing from `select` is missing from the
  // row, so whether the consumer still needs it is answered by the output.
  return Promise.resolve(rows.map((r) => Object.fromEntries(
    Object.keys(args.select ?? r).filter((k) => (args.select ?? r)[k]).map((k) => [k, r[k]]),
  )));
};

const useTable = (table = TABLE) => {
  prisma.metricSnapshot.findMany.mockImplementation(fakeFindMany(table));
};

const argsOf = () => prisma.metricSnapshot.findMany.mock.calls[0][0];
/** The entity inputs buildEntityInputs produced, as they reach the engine. */
const entitiesOf = () => generateAgenda.mock.calls[0][0].entities;
const entity = (id) => entitiesOf().find((e) => e.entityId === id);

beforeEach(() => {
  vi.clearAllMocks();
  useTable();
  // Only acct-1 resolves. camp-1 is campaign-grain and finds no Account row,
  // which is the ordinary production case and the reason the snapshot fallbacks
  // below are a live path rather than defensive dead code.
  prisma.account.findMany.mockResolvedValue([{ id: 'acct-1', name: 'Prospecting', channel: 'META' }]);
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.decisionMemoryEntry.findMany.mockResolvedValue([]);
  prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
});

describe('R3.7 — TestGeneratorService on the Evidence seam', () => {
  // ── ownership ────────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('contains no direct MetricSnapshot query (I14)', () => {
      expect(SRC).not.toMatch(/prisma\s*\.\s*metricSnapshot/);
      expect(SRC).toMatch(/selectOperationalSnapshots/);
      // Its other tables stay its own — I14 is about MetricSnapshot alone.
      expect(SRC).toMatch(/prisma\.decision\.findMany/);
      expect(SRC).toMatch(/prisma\.decisionMemoryEntry\.findMany/);
      expect(SRC).toMatch(/prisma\.testExperiment\.createMany/);
    });

    it('states no population of its own any more', () => {
      expect(SRC).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
      expect(SRC).not.toMatch(/measurementWindow/);
    });

    it('keeps the platform source gate in the service, not in the seam', () => {
      expect(SRC).toMatch(/const PLATFORM_SOURCES = new Set\(\['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN'\]\)/);
      expect(SRC).toMatch(/if \(!PLATFORM_SOURCES\.has\(s\.source\)\) continue;/);
    });

    it('adds NO error swallow — this read never had one', () => {
      expect(SRC).not.toMatch(/selectOperationalSnapshots[\s\S]{0,600}?\.catch/);
    });
  });

  // ── the projection: the one intentional change ───────────────────────────
  describe('the explicit projection', () => {
    it('names exactly the eleven fields the consumer reads', async () => {
      await getWeeklyAgenda(WS);
      expect(argsOf().select).toEqual(REQUIRED_PROJECTION);
      expect(Object.keys(argsOf().select).sort()).toHaveLength(11);
    });

    it('drops the columns nothing here opens', async () => {
      // The read was select-less, so every one of these arrived on every row.
      await getWeeklyAgenda(WS);
      for (const dropped of ['actionMetrics', 'reach', 'cpaMinor', 'dailyBudgetMinor',
        'windowStart', 'windowEnd', 'granularity', 'measurementWindow', 'id', 'workspaceId']) {
        expect(argsOf().select[dropped]).toBeUndefined();
      }
    });

    it('does NOT project ctr or roas, which are recomputed from sums', async () => {
      // The columns exist on the row. Reading them would be wrong once rows are
      // added together, so buildEntityInputs derives both — and this fixture's
      // stored values (1.0/3.0 and 2.0/4.0) disagree with the aggregate on
      // purpose, so a projection that added them could not go unnoticed.
      await getWeeklyAgenda(WS);
      expect(argsOf().select.ctr).toBeUndefined();
      expect(argsOf().select.roas).toBeUndefined();
      expect(entity('camp-1').metrics.ctr).toBe(EXPECTED_CAMP1.ctr);
      expect(entity('camp-1').metrics.ctr).not.toBe(1.0);
      expect(entity('camp-1').metrics.ctr).not.toBe(3.0);
      expect(entity('camp-1').metrics.roas).not.toBe(2.0);
      expect(entity('camp-1').metrics.roas).not.toBe(4.0);
    });
  });

  // ── population parity ────────────────────────────────────────────────────
  describe('population parity with the pre-migration query', () => {
    it('issues the same predicates, key for key', async () => {
      const before = Date.now();
      await getWeeklyAgenda(WS);
      const after = Date.now();
      const args = argsOf();

      expect(args.where.workspaceId).toBe(WS);
      expect(args.where.measurementWindow).toEqual(OPERATIONAL_WINDOWS);

      const days = TEMPORAL.testGeneratorSyncRecencyDays;
      const gte = args.where.date.gte.getTime();
      expect(gte).toBeGreaterThanOrEqual(before - days * 86_400_000);
      expect(gte).toBeLessThanOrEqual(after - days * 86_400_000);

      expect(Object.keys(args.where).sort()).toEqual(['date', 'measurementWindow', 'workspaceId']);
      // `select` is the addition; nothing else joined it.
      expect(Object.keys(args).sort()).toEqual(['select', 'where']);
    });

    it('carries NO orderBy — the key must be absent', async () => {
      await getWeeklyAgenda(WS);
      expect(argsOf()).not.toHaveProperty('orderBy');
    });

    it('bounds sync recency on `date`, never windowStart/windowEnd', async () => {
      await getWeeklyAgenda(WS);
      expect(argsOf().where.date).toBeDefined();
      expect(argsOf().where.windowStart).toBeUndefined();
      expect(argsOf().where.windowEnd).toBeUndefined();
    });

    it('uses the configured 14-day default, unrenamed', async () => {
      expect(TEMPORAL.testGeneratorSyncRecencyDays).toBe(14);
      const before = Date.now();
      await getWeeklyAgenda(WS);
      expect(argsOf().where.date.gte.getTime()).toBeLessThanOrEqual(before - 13 * 86_400_000);
    });

    it('keeps the caller lookback authoritative', async () => {
      const before = Date.now();
      await getWeeklyAgenda(WS, { lookbackDays: 17 });
      const after = Date.now();
      const gte = argsOf().where.date.gte.getTime();
      expect(gte).toBeGreaterThanOrEqual(before - 17 * 86_400_000);
      expect(gte).toBeLessThanOrEqual(after - 17 * 86_400_000);
      // …and is genuinely not the 14-day default that happens to pass.
      expect(gte).toBeLessThan(after - 14 * 86_400_000);
    });

    it('applies no source filter in the QUERY, no narrowing, no reduction', async () => {
      await getWeeklyAgenda(WS);
      expect(argsOf().where.source).toBeUndefined();
      expect(argsOf().where.entityId).toBeUndefined();
      expect(argsOf().distinct).toBeUndefined();
      expect(argsOf().take).toBeUndefined();
      expect(argsOf().skip).toBeUndefined();
    });

    it('reads evidence exactly once — a fallback leaves no other trace', async () => {
      useTable([]);
      await getWeeklyAgenda(WS);
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    });

    it('never asks for a second population when the first is empty (I4)', async () => {
      useTable([]);
      await getWeeklyAgenda(WS);
      for (const [call] of prisma.metricSnapshot.findMany.mock.calls) {
        expect(call.where.measurementWindow).toEqual(OPERATIONAL_WINDOWS);
      }
    });
  });

  // ── OUTPUT parity — the entity inputs, not the arguments ────────────────
  describe('entity-input output parity', () => {
    it('aggregates a campaign\'s rows into one entity input', async () => {
      await getWeeklyAgenda(WS);
      const e = entity('camp-1');
      expect(e.metrics.spendMinor).toBe(EXPECTED_CAMP1.spendMinor);
      expect(e.metrics.conversions).toBe(EXPECTED_CAMP1.conversions);
      expect(e.verdict).toBe('HOLD'); // no Decision rows → the documented default
    });

    it('CTR is recomputed from AGGREGATED impressions and clicks', async () => {
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').metrics.ctr).toBe(2.5);   // 100 / 4 000 × 100
      expect(entity('camp-1').metrics.ctr).not.toBe(1); // the first row alone
    });

    it('ROAS is recomputed from AGGREGATED revenue and spend', async () => {
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').metrics.roas).toBe(3.5);   // 140 000 / 40 000
      expect(entity('camp-1').metrics.roas).not.toBe(2); // the first row alone
    });

    it('CPA is recomputed from AGGREGATED spend and conversions', async () => {
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').metrics.cpa).toBe(20);      // 400 EGP / 20
      expect(entity('camp-1').metrics.cpa).not.toBe(25);  // the first row alone
    });

    it('frequency takes the LATEST row, never the sum', async () => {
      // Per-audience, not additive. 5.0 is the newer of the two eligible rows.
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').metrics.frequency).toBe(5.0);
      expect(entity('camp-1').metrics.frequency).not.toBe(7.0); // 2.0 + 5.0
      expect(entity('camp-1').metrics.frequency).not.toBe(2.0); // the older row
    });

    it('another tenant\'s rows never reach an entity input', async () => {
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').metrics.spendMinor).toBe(40_000);
      expect(entity('camp-1').metrics.frequency).not.toBe(66.0);
    });

    it('a row older than the bound is excluded', async () => {
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').metrics.frequency).not.toBe(88.0);
      expect(entity('camp-1').metrics.spendMinor).toBeLessThan(888_000);
    });

    it('a canonical row is excluded — it would otherwise be the newest frequency', async () => {
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').metrics.frequency).not.toBe(77.0);
      expect(entity('camp-1').metrics.conversions).toBe(20);
    });

    it('a non-platform row is FETCHED by the seam and skipped in memory', async () => {
      // Both halves. If the seam filtered GA4 out, the in-memory gate would be
      // dead code reaching the same number by a different route — and the GA4
      // row here is the NEWEST, so it would otherwise own the frequency.
      await getWeeklyAgenda(WS);
      expect(argsOf().where.source).toBeUndefined();
      expect(entity('camp-1').metrics.frequency).toBe(5.0);
      expect(entity('camp-1').metrics.frequency).not.toBe(99.0);
    });

    it('an empty population yields no entity inputs, not invented ones', async () => {
      useTable([]);
      await getWeeklyAgenda(WS);
      expect(entitiesOf()).toEqual([]);
    });
  });

  // ── the two fallbacks the projection has to keep alive ──────────────────
  describe('snapshot metadata fallbacks (live paths, not defensive code)', () => {
    it('entityLevel falls back to the SNAPSHOT when metadata does not resolve', async () => {
      // labelsById is keyed off Account.id; camp-1 is campaign-grain and misses.
      // Dropping entityLevel from the projection turns this into null.
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').level).toBe('ADSET');
      expect(entity('camp-1').level).not.toBeNull();
    });

    it('currency falls back to the SNAPSHOT when metadata does not resolve', async () => {
      // Dropping currency from the projection turns this into the 'USD' default,
      // and silently reinterprets every minor-unit figure on the row.
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').currency).toBe('EGP');
      expect(entity('camp-1').currency).not.toBe('USD');
    });

    it('name falls back to the entityId when metadata does not resolve', async () => {
      await getWeeklyAgenda(WS);
      expect(entity('camp-1').name).toBe('camp-1');
    });

    it('and RESOLVED metadata still wins — proving these are fallbacks', async () => {
      // acct-1 matches an Account row, so level comes from the label map
      // ('CAMPAIGN', hardcoded there) and currency from the workspace ('USD'),
      // both overriding the snapshot's 'ADSET'/'EGP'.
      await getWeeklyAgenda(WS);
      expect(entity('acct-1').name).toBe('Prospecting');
      expect(entity('acct-1').level).toBe('CAMPAIGN');
      expect(entity('acct-1').currency).toBe('USD');
    });
  });

  // ── isolation and failure ───────────────────────────────────────────────
  describe('isolation and failure', () => {
    it('cannot read across workspaces', async () => {
      await getWeeklyAgenda(WS);
      expect(argsOf().where.workspaceId).toBe(WS);
      await expect(getWeeklyAgenda(null)).rejects.toThrow(/workspaceId required/);
    });

    it('lets a read failure PROPAGATE — this read never swallowed', async () => {
      // An agenda built over a swallowed error would report "nothing worth
      // testing" about a database it could not reach. The absence of a catch is
      // part of the contract being migrated, not an oversight to tidy up.
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      await expect(getWeeklyAgenda(WS)).rejects.toThrow('db down');
    });
  });
});
