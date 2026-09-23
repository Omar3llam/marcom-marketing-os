// ============================================================
// R3.4 — Economics migrated onto the Evidence seam
// ============================================================
// A separate file from EconomicsService.test.js, which owns the CALCULATION
// contract (realized CAC vs a plan projection, the assessment's refusal to
// compute off defaults). This one owns the READ: that moving the query behind
// the Evidence layer changed the query in no respect at all.
//
// WHY THIS FILE USES A FAKE TABLE RATHER THAN A CANNED ROW LIST
// -------------------------------------------------------------
// Every other approach makes the interesting mutations invisible. If the mock
// returns a fixed array whatever it is asked, then dropping `workspaceId`,
// dropping the entity narrowing, or admitting canonical rows all return exactly
// the same rows and every assertion still passes — the test would be proving
// that the arguments look right, which is a weaker claim than the one that
// matters. So `metricSnapshot.findMany` here actually APPLIES the predicates it
// is given to a small table containing, on purpose:
//
//   • another workspace's row for the same entity, newer      (workspace scope)
//   • an entity that is NOT one of blended truth's channels    (entity narrowing)
//   • a CUMULATIVE_30D row sharing entityId, source AND `date` (Phase G)
//   • a MANUAL row that is the newest reading overall          (in-memory source skip)
//   • three overlapping trailing-window totals for one stream  (#359)
//   • a channel whose ONLY reading is months old               (no temporal bound)
//
// Each one changes the CAC if the corresponding predicate is lost. The last is
// there so that "this query has no lookback" is provable by the FIGURES and not
// only by the absence of a key: any `since` a future edit might add — 30 days,
// 60, 90 — drops that channel out of the denominator, and a channel missing from
// the denominator makes acquisition look cheaper than it is.
//
// The canonical row deliberately shares its `date` with the operational row, as
// it does in production — one sync run stamps one `now`. That makes the tie
// order-decided, so the population tests run the SAME table in both directions
// and require the same answer. Losing the window filter cannot survive that:
// one of the two orders reads 7 conversions where there are 50.
//
// The real engine and the real latestPerStream run throughout. Only the DB and
// blended truth are mocked.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// latestPerStream stays REAL for the same reason EconomicsService.test.js keeps
// it real: the invariant is that Economics and Attribution reduce identically,
// and a stub of the reduction would let them drift while both suites stayed green.
vi.mock('../blended-truth/BlendedTruthService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBlendedTruth: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    accountEconomics: { findUnique: vi.fn() },
    workspace:        { findUnique: vi.fn() },
    metricSnapshot:   { findMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { getCurrentCac } from './EconomicsService.js';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'EconomicsService.js'),
  'utf8',
);

const WS = 'ws-econ';

// ── The literal pre-migration query ─────────────────────────────────────────
//
// Reconstructed BY HAND from the diff, not imported. Importing
// OPERATIONAL_WINDOW_FILTER here would let the test agree with the
// implementation about what the population is, which is precisely the agreement
// a parity test is supposed to withhold: if someone changed the constant, both
// sides would move together and this file would keep passing.
const PRE_MIGRATION_SELECT = { entityId: true, date: true, conversions: true, source: true };
const PRE_MIGRATION_WINDOWS = { in: ['LEGACY_UNKNOWN', 'ROLLING_WINDOW'] };

// ── The fake table ──────────────────────────────────────────────────────────

const d = (n) => new Date(`2026-08-0${n}T09:00:00Z`);
const rowOf = (over) => ({
  workspaceId: WS, measurementWindow: 'ROLLING_WINDOW', source: 'META',
  conversions: 0, ...over,
});

const TABLE = [
  // meta: three overlapping trailing-window totals — the newest supersedes (#359)
  rowOf({ entityId: 'meta',   date: d(1), conversions: 40 }),
  rowOf({ entityId: 'meta',   date: d(2), conversions: 46 }),
  rowOf({ entityId: 'meta',   date: d(3), conversions: 50 }),
  // google, on the other legacy window value — LEGACY_UNKNOWN must stay eligible
  rowOf({ entityId: 'google', date: d(2), conversions: 30, source: 'GOOGLE',
    measurementWindow: 'LEGACY_UNKNOWN' }),
  // the Phase F canonical row: same entity, same source, SAME DATE
  rowOf({ entityId: 'meta',   date: d(3), conversions: 7, measurementWindow: 'CUMULATIVE_30D' }),
  // newest reading overall, and not an acquisition source — skipped in memory
  rowOf({ entityId: 'meta',   date: d(5), conversions: 999, source: 'MANUAL',
    measurementWindow: 'LEGACY_UNKNOWN' }),
  // an entity blended truth did not return
  rowOf({ entityId: 'orphan', date: d(4), conversions: 500 }),
  // another tenant's row for the same entity id, newer than anything above
  rowOf({ entityId: 'meta',   date: d(9), conversions: 777, workspaceId: 'ws-other' }),
  // a paused channel, last synced in January: real spend, real conversions, and
  // outside any lookback anyone would be tempted to add.
  rowOf({ entityId: 'tiktok', date: new Date('2026-01-05T09:00:00Z'), conversions: 20,
    source: 'TIKTOK' }),
];

/** conversions Economics must arrive at: meta's newest 50 + google's 30 + tiktok's 20. */
const EXPECTED_CONVERSIONS = 100;
const SPEND_MINOR = 100_000;                                  // 60 000 + 40 000 + 0
const EXPECTED_CAC = Math.round(SPEND_MINOR / EXPECTED_CONVERSIONS); // 1 000

const CHANNELS = [
  { channelId: 'meta',   spendMinor: 60_000, currency: 'USD' },
  { channelId: 'google', spendMinor: 40_000, currency: 'USD' },
  // Paused: blended truth still returns it, and its historical conversions still
  // belong in a realized CAC. Zero spend keeps the numerator unchanged so the
  // temporal assertions below move only the denominator.
  { channelId: 'tiktok', spendMinor: 0,      currency: 'USD' },
];

/**
 * A findMany that honours the predicates it is handed. Only the operators this
 * query has ever used are implemented; anything else would be inventing a
 * contract rather than reproducing one.
 */
const fakeFindMany = (table) => (args = {}) => {
  const w = args.where ?? {};
  let rows = table.filter((r) => (
    (w.workspaceId === undefined || r.workspaceId === w.workspaceId)
    && (w.measurementWindow === undefined || w.measurementWindow.in.includes(r.measurementWindow))
    && (w.entityId === undefined || w.entityId.in.includes(r.entityId))
    && (w.source === undefined || w.source.in.includes(r.source))
    && (w.date === undefined || r.date >= w.date.gte)
  ));
  // Implemented ONLY so a forbidden reduction is visible in the output rather
  // than merely in the arguments.
  if (args.distinct) {
    const seen = new Set();
    rows = rows.filter((r) => {
      const k = [].concat(args.distinct).map((f) => r[f]).join('|');
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }
  if (args.take != null) rows = rows.slice(0, args.take);
  // Projection is applied, so the `select` is load-bearing too: drop
  // `conversions` from it and the CAC goes null.
  return Promise.resolve(rows.map((r) => Object.fromEntries(
    Object.keys(args.select ?? r).filter((k) => (args.select ?? r)[k]).map((k) => [k, r[k]]),
  )));
};

const useTable = (table = TABLE) => {
  prisma.metricSnapshot.findMany.mockImplementation(fakeFindMany(table));
};

const argsOf = () => prisma.metricSnapshot.findMany.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
  getBlendedTruth.mockResolvedValue({ channels: CHANNELS, portfolio: { monetaryEvidence: { spend: { monetaryStatus: 'MONETARY_VALID', monetaryReason: null, currency: 'USD' } } } });
  useTable();
});

describe('R3.4 — EconomicsService on the Evidence seam', () => {
  // ── ownership ────────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('contains no direct MetricSnapshot query (I14)', () => {
      expect(SRC).not.toMatch(/prisma\s*\.\s*metricSnapshot/);
      expect(SRC).toMatch(/selectOperationalSnapshots/);
      // Its own tables stay its own — I14 is about MetricSnapshot alone.
      expect(SRC).toMatch(/prisma\.accountEconomics/);
      expect(SRC).toMatch(/prisma\.workspace\.findUnique/);
    });

    it('states no population of its own any more', () => {
      expect(SRC).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
      expect(SRC).not.toMatch(/measurementWindow/);
    });

    it('keeps its OWN error swallow at its OWN call site', () => {
      // This read has always degraded to []. Preserving that is the migration;
      // moving it into the seam would impose it on every other consumer, where
      // an unreachable database would start reading as "no metrics".
      expect(SRC).toMatch(/selectOperationalSnapshots\([\s\S]*?\}\)\.catch\(\(\) => \[\]\)/);
    });

    it('still shares latestPerStream with Attribution rather than copying it', () => {
      expect(SRC).toMatch(/import \{ getBlendedTruth, latestPerStream \} from '\.\.\/blended-truth\/BlendedTruthService\.js'/);
      expect(SRC).toMatch(/latestPerStream\(snaps\)/);
    });
  });

  // ── query parity against a hand-written reconstruction ───────────────────
  describe('query parity with the pre-migration read', () => {
    it('issues exactly the pre-migration query, key for key', async () => {
      await getCurrentCac(WS);
      const args = argsOf();

      expect(args.where.workspaceId).toBe(WS);
      expect(args.where.entityId).toEqual({ in: ['meta', 'google', 'tiktok'] });
      expect(args.where.measurementWindow).toEqual(PRE_MIGRATION_WINDOWS);
      expect(args.select).toEqual(PRE_MIGRATION_SELECT);

      // Nothing added, nothing dropped, at either level.
      expect(Object.keys(args.where).sort()).toEqual(['entityId', 'measurementWindow', 'workspaceId']);
      expect(Object.keys(args).sort()).toEqual(['select', 'where']);
    });

    it('carries NO temporal bound — this query has never had one', async () => {
      // #359 was not fixed by adding a lookback; it was fixed by latestPerStream.
      // A `since` here would drop channels whose last sync predates it, and a
      // channel missing from the denominator makes acquisition look CHEAPER,
      // which is the direction that gets a budget increased.
      await getCurrentCac(WS);
      expect(argsOf().where.date).toBeUndefined();
      expect(argsOf().where.windowStart).toBeUndefined();
      expect(argsOf().where.windowEnd).toBeUndefined();
    });

    it('and proves it by the FIGURES: a channel last synced in January still counts', async () => {
      // The absence of a key is a weak claim on its own — it says nothing about
      // what the query returns. tiktok's only reading is months old, so any
      // lookback drops it and the CAC rises from 1 000 to 1 250. The number is
      // the assertion.
      const cac = await getCurrentCac(WS);
      expect(cac.totalConversions).toBe(EXPECTED_CONVERSIONS);
      expect(cac.currentBlendedCacMinor).toBe(EXPECTED_CAC);
      expect(cac.currentBlendedCacMinor).not.toBe(1_250); // what a 30-day bound would report
    });

    it('carries NO orderBy — the key must be absent', async () => {
      await getCurrentCac(WS);
      expect(argsOf()).not.toHaveProperty('orderBy');
    });

    it('applies no source filter in the QUERY — the skip stays in memory', async () => {
      // Economics excludes non-platform sources after the reduction, by set
      // membership. Where that exclusion happens is the behaviour being
      // preserved, not an implementation detail: a query-level allow-list would
      // also stop MANUAL rows from ever being counted as a stream.
      await getCurrentCac(WS);
      expect(argsOf().where.source).toBeUndefined();
    });

    it('adds no reduction at the Evidence layer', async () => {
      await getCurrentCac(WS);
      expect(argsOf().distinct).toBeUndefined();
      expect(argsOf().take).toBeUndefined();
      expect(argsOf().skip).toBeUndefined();
    });

    it('reads evidence exactly once — a fallback leaves no other trace', async () => {
      useTable([]);
      await getCurrentCac(WS);
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    });

    it('never asks for a second population when the first is empty (I4)', async () => {
      useTable([]);
      await getCurrentCac(WS);
      for (const [call] of prisma.metricSnapshot.findMany.mock.calls) {
        expect(call.where.measurementWindow).toEqual(PRE_MIGRATION_WINDOWS);
      }
    });
  });

  // ── OUTPUT parity — the figures, not the arguments ───────────────────────
  describe('unit-economics output parity', () => {
    // Both orders, because the canonical row ties with the operational one on
    // `date`. If the window filter were lost the two orders would disagree, and
    // one of them would read 7 where there are 50.
    for (const [label, table] of [['as stored', TABLE], ['reversed', [...TABLE].reverse()]]) {
      it(`realized CAC is ${EXPECTED_CAC} — ${label}`, async () => {
        useTable(table);
        const cac = await getCurrentCac(WS);
        expect(cac.totalConversions).toBe(EXPECTED_CONVERSIONS);
        expect(cac.totalSpendMinor).toBe(SPEND_MINOR);
        expect(cac.currentBlendedCacMinor).toBe(EXPECTED_CAC);
        expect(cac.currency).toBe('USD');
      });
    }

    it('overlapping trailing windows supersede rather than sum (#359 preserved)', async () => {
      const cac = await getCurrentCac(WS);
      expect(cac.totalConversions).not.toBe(40 + 46 + 50 + 30 + 20); // 186, the defect
      expect(cac.currentBlendedCacMinor).not.toBe(538);
    });

    it('another tenant\'s newer row cannot enter the denominator', async () => {
      // ws-other's row is the newest 'meta' reading in the table. If workspace
      // scope were lost it would win the stream and CAC would collapse to 121.
      const cac = await getCurrentCac(WS);
      expect(cac.totalConversions).toBe(EXPECTED_CONVERSIONS);
      expect(cac.totalConversions).not.toBe(777 + 30 + 20);
    });

    it('an entity blended truth did not return contributes nothing', async () => {
      // 'orphan' is a real operational row in this workspace. Only the entity
      // narrowing keeps it out, and without it CAC reads 167 instead of 1 000.
      const cac = await getCurrentCac(WS);
      expect(cac.totalConversions).not.toBe(EXPECTED_CONVERSIONS + 500);
      expect(cac.currentBlendedCacMinor).toBe(EXPECTED_CAC);
    });

    it('a MANUAL reading is a stream of its own and is still not an acquisition', async () => {
      const cac = await getCurrentCac(WS);
      expect(cac.totalConversions).not.toBe(999 + 30 + 20);
    });

    it('zero conversions yields a NULL CAC, never a number', async () => {
      useTable([rowOf({ entityId: 'meta', date: d(1), conversions: 0 })]);
      const cac = await getCurrentCac(WS);
      expect(cac.totalConversions).toBe(0);
      expect(cac.currentBlendedCacMinor).toBeNull();
    });

    it('an empty population yields a NULL CAC, not a free acquisition', async () => {
      useTable([]);
      const cac = await getCurrentCac(WS);
      expect(cac.totalConversions).toBe(0);
      expect(cac.currentBlendedCacMinor).toBeNull();
      expect(cac.totalSpendMinor).toBe(SPEND_MINOR); // spend is still real
    });

    it('no channels means no read at all', async () => {
      getBlendedTruth.mockResolvedValue({ channels: [], portfolio: { monetaryEvidence: { spend: { monetaryStatus: 'MONETARY_VALID', monetaryReason: null, currency: 'USD' } } } });
      const cac = await getCurrentCac(WS);
      expect(cac.currentBlendedCacMinor).toBeNull();
      expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
    });
  });

  // ── isolation and failure ────────────────────────────────────────────────
  describe('isolation and failure', () => {
    it('cannot read across workspaces', async () => {
      await getCurrentCac(WS);
      expect(argsOf().where.workspaceId).toBe(WS);
      await expect(getCurrentCac(null)).rejects.toThrow(/workspaceId required/);
    });

    it('degrades a failed read to zero conversions and a NULL CAC — preserved', async () => {
      // The pre-migration read carried `.catch(() => [])`, so a database failure
      // has always produced a null CAC rather than an exception. R3 moves the
      // query, not this decision. What it must NEVER produce is a CAC computed
      // from real spend and a fabricated zero denominator — and it cannot,
      // because zero conversions is exactly the case that returns null.
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      const cac = await getCurrentCac(WS);
      expect(cac.totalConversions).toBe(0);
      expect(cac.currentBlendedCacMinor).toBeNull();
      expect(cac.totalSpendMinor).toBe(SPEND_MINOR);
    });

    it('the seam itself still refuses to swallow — the catch is Economics\' own', async () => {
      // Proves the swallow above comes from this call site and not from the
      // Evidence layer, which every other consumer relies on to propagate.
      const { selectOperationalSnapshots } = await import('../evidence/index.js');
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      await expect(selectOperationalSnapshots(WS, { select: PRE_MIGRATION_SELECT }))
        .rejects.toThrow('db down');
    });
  });
});
