// ============================================================
// R3.5 — Attribution migrated onto the Evidence seam
// ============================================================
// A separate file from AttributionService.test.js, which owns the CONVERSION
// contract (#359: the newest trailing-window row IS the count). This one owns
// the READ, and one thing that has never been owned anywhere: the claim that
// Attribution and Economics derive per-channel conversions IDENTICALLY.
//
// THE SHARED INVARIANT, MADE BEHAVIOURAL
// ---------------------------------------
// Both services divide by the same number and would report different things if
// it drifted — Attribution divides revenue by conversions, Economics divides
// spend by them, so a divergence makes per-conversion value and CAC tell two
// different stories about one account, with nothing throwing. Until now that
// was enforced by a comment in each file saying it MUST match the other, plus a
// shared `latestPerStream`. Sharing the reduction kept HOW the rows collapse in
// step; it said nothing about WHICH rows arrive. This file runs both services
// over one table and requires the same answer — and it does it by comparing the
// two services' OWN outputs, never by re-implementing the reduction here, which
// would only prove the test agrees with itself.
//
// WHY A FAKE TABLE RATHER THAN A CANNED ROW LIST
// -----------------------------------------------
// A mock that returns fixed rows however it is asked makes the interesting
// mutations invisible: dropping workspaceId, dropping the entity narrowing, or
// admitting canonical rows all return the same array and every assertion still
// passes. So `findMany` here APPLIES the predicates it is handed. The table is
// the same one R3.4 used for Economics, deliberately — the parity claim is only
// worth something if both services see identical input.
//
// The real engine, the real latestPerStream and the real getEconomics all run.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// latestPerStream stays REAL — it is half of the invariant under test.
vi.mock('../blended-truth/BlendedTruthService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBlendedTruth: vi.fn(),
}));
// EconomicsService is NOT mocked, on purpose: the parity test needs the real
// getCurrentCac to run beside the real getAttribution over the same rows.
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    metricSnapshot:     { findMany: vi.fn() },
    incrementalityTest: { findMany: vi.fn() },
    pathTouch:          { findMany: vi.fn() },
    accountEconomics:   { findUnique: vi.fn() },
    workspace:          { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getBlendedTruth } from '../blended-truth/BlendedTruthService.js';
import { getAttribution, buildAttributionInputs } from './AttributionService.js';
import { getCurrentCac } from '../unit-economics/EconomicsService.js';
import { ATTRIBUTION_MODEL } from './attributionTypes.js';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'AttributionService.js'),
  'utf8',
);

const WS = 'ws-attr';

// ── The literal pre-migration query ─────────────────────────────────────────
//
// Reconstructed BY HAND from the diff. Importing OPERATIONAL_WINDOW_FILTER here
// would let the test agree with the implementation about what the population
// is, which is exactly the agreement a parity test must withhold.
const PRE_MIGRATION_SELECT = { entityId: true, date: true, conversions: true, source: true };
const PRE_MIGRATION_WINDOWS = { in: ['LEGACY_UNKNOWN', 'ROLLING_WINDOW'] };

// ── The fake table (identical to R3.4's Economics fixture) ──────────────────

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
  // newest reading overall, and not an acquisition source — its own stream,
  // skipped in memory rather than in the query
  rowOf({ entityId: 'meta',   date: d(5), conversions: 999, source: 'MANUAL',
    measurementWindow: 'LEGACY_UNKNOWN' }),
  // an entity blended truth did not return
  rowOf({ entityId: 'orphan', date: d(4), conversions: 500 }),
  // another tenant's row for the same entity id, newer than anything above
  rowOf({ entityId: 'meta',   date: d(9), conversions: 777, workspaceId: 'ws-other' }),
  // a paused channel last synced in January: outside any lookback anyone would
  // be tempted to add, and its conversions are still real
  rowOf({ entityId: 'tiktok', date: new Date('2026-01-05T09:00:00Z'), conversions: 20,
    source: 'TIKTOK' }),
];

/** What each channel must be credited: the newest platform row per stream. */
const EXPECTED_BY_CHANNEL = { meta: 50, google: 30, tiktok: 20 };
const EXPECTED_TOTAL = 100;

const chan = (channelId, over = {}) => ({
  channelId, channel: channelId.toUpperCase(), currency: 'USD',
  monetaryStatus: 'MONETARY_VALID', platformMonetaryStatus: 'MONETARY_VALID',
  monetaryEvidence: { platform: { monetaryStatus: 'MONETARY_VALID', currency: 'USD' } },
  spendMinor: 100_000, platformRevenueMinor: 200_000, blendedRevenueMinor: 200_000, ...over,
});
const CHANNELS = [chan('meta'), chan('google'), chan('tiktok', { spendMinor: 0 })];

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
  // Projection is applied, so `select` is load-bearing: drop `conversions` and
  // every credited count goes to zero.
  return Promise.resolve(rows.map((r) => Object.fromEntries(
    Object.keys(args.select ?? r).filter((k) => (args.select ?? r)[k]).map((k) => [k, r[k]]),
  )));
};

const useTable = (table = TABLE) => {
  prisma.metricSnapshot.findMany.mockImplementation(fakeFindMany(table));
};

const argsOf = () => prisma.metricSnapshot.findMany.mock.calls[0][0];

// LAST_TOUCH passes each channel's platform-reported conversions straight
// through, so what these assertions observe IS the number this PR moves, with
// no model arithmetic in between to mask it.
const lastTouch = () => getAttribution(WS, { model: ATTRIBUTION_MODEL.LAST_TOUCH });
const conversionsOf = (result, channelId) =>
  result.channels?.find((r) => r.channelId === channelId)?.creditedConversions?.value ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  getBlendedTruth.mockResolvedValue({ channels: CHANNELS, portfolio: { spendMinor: 200_000, monetaryEvidence: { spend: { monetaryStatus: 'MONETARY_VALID', currency: 'USD' } } } });
  prisma.incrementalityTest.findMany.mockResolvedValue([]);
  prisma.pathTouch.findMany.mockResolvedValue([]);
  prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
  prisma.accountEconomics.findUnique.mockResolvedValue({
    workspaceId: WS, currency: 'USD', aovMinor: 10_000, grossMarginPct: 0.6,
    repeatRate: 0, avgOrdersPerCustomer: 2, targetLtvToCac: 3,
  });
  useTable();
});

describe('R3.5 — AttributionService on the Evidence seam', () => {
  // ── ownership ────────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('contains no direct MetricSnapshot query (I14)', () => {
      expect(SRC).not.toMatch(/prisma\s*\.\s*metricSnapshot/);
      expect(SRC).toMatch(/selectOperationalSnapshots/);
      // Its other tables stay its own — I14 is about MetricSnapshot alone.
      expect(SRC).toMatch(/prisma\.incrementalityTest\.findMany/);
      expect(SRC).toMatch(/prisma\.pathTouch\.findMany/);
    });

    it('states no population of its own any more', () => {
      expect(SRC).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
      expect(SRC).not.toMatch(/measurementWindow/);
    });

    it('keeps its OWN error swallow at its OWN call site', () => {
      // Anchored on `orderBy: null`, which appears exactly once in the file, so
      // the match cannot drift forward to the read on IncrementalityTest below.
      // A structural assertion that can be satisfied by a different statement is
      // not a structural assertion — the first draft of this test was, and
      // passed with the catch deleted.
      //
      // B5-01T′ CHANGED THE SHAPE, NOT THE DECISION. The swallow is still this
      // service's own and still at this call site; it is now `readOrNull`, which
      // returns null instead of [] so the failure survives to the caller. The
      // behavioural half is the empty-vs-failed pair further down — this only
      // keeps the swallow from migrating into the shared Evidence seam, where it
      // would turn one dead read into "no metrics" for every other consumer.
      expect(SRC).toMatch(/orderBy:\s*null,\s*\}\),\s*\{\s*workspaceId,\s*read:\s*'MetricSnapshot'\s*\}\)/);
      expect(SRC).toMatch(/function readOrNull[\s\S]*?\.catch\(/);
      // …and no bare `catch(() => [])` may come back anywhere in the file: that
      // is the exact form that made a failure indistinguishable from an account
      // with no data.
      expect(SRC).not.toMatch(/\.catch\(\(\) => \[\]\)/);
    });

    it('keeps the reduction and the source filter in the service', () => {
      expect(SRC).toMatch(/latestPerStream\(snaps \?\? \[\]\)/);
      expect(SRC).toMatch(/PLATFORM_SOURCES\.has\(s\.source\)/);
    });
  });

  // ── query parity against a hand-written reconstruction ───────────────────
  describe('query parity with the pre-migration read', () => {
    it('issues exactly the pre-migration query, key for key', async () => {
      await lastTouch();
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
      await lastTouch();
      expect(argsOf().where.date).toBeUndefined();
      expect(argsOf().where.windowStart).toBeUndefined();
      expect(argsOf().where.windowEnd).toBeUndefined();
    });

    it('and proves it by the FIGURES: a channel last synced in January still counts', async () => {
      // The absence of a key says nothing about what the query returns. tiktok's
      // only reading is months old; any lookback drops it and its credited
      // conversions fall to 0.
      expect(conversionsOf(await lastTouch(), 'tiktok')).toBe(20);
    });

    it('carries NO orderBy — the key must be absent', async () => {
      await lastTouch();
      expect(argsOf()).not.toHaveProperty('orderBy');
    });

    it('applies no source filter in the QUERY — the skip stays in memory', async () => {
      // A query-level allow-list would also stop the MANUAL row from ever
      // occupying its own stream, which is a different behaviour reaching the
      // same number by luck on this fixture.
      await lastTouch();
      expect(argsOf().where.source).toBeUndefined();
    });

    it('adds no reduction at the Evidence layer', async () => {
      await lastTouch();
      expect(argsOf().distinct).toBeUndefined();
      expect(argsOf().take).toBeUndefined();
      expect(argsOf().skip).toBeUndefined();
    });

    it('reads evidence exactly once — a fallback leaves no other trace', async () => {
      useTable([]);
      await lastTouch();
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    });

    it('never asks for a second population when the first is empty (I4)', async () => {
      useTable([]);
      await lastTouch();
      for (const [call] of prisma.metricSnapshot.findMany.mock.calls) {
        expect(call.where.measurementWindow).toEqual(PRE_MIGRATION_WINDOWS);
      }
    });
  });

  // ── OUTPUT parity — credited conversions, not arguments ─────────────────
  describe('attribution output parity', () => {
    // Both orders, because the canonical row ties with the operational one on
    // `date`. Without the window filter the two orders disagree, and one of
    // them credits 7 conversions where there are 50.
    for (const [label, table] of [['as stored', TABLE], ['reversed', [...TABLE].reverse()]]) {
      it(`credits 50 / 30 / 20 — ${label}`, async () => {
        useTable(table);
        const result = await lastTouch();
        for (const [id, n] of Object.entries(EXPECTED_BY_CHANNEL)) {
          expect(conversionsOf(result, id)).toBe(n);
        }
      });
    }

    it('overlapping trailing windows supersede rather than sum (#359 preserved)', async () => {
      expect(conversionsOf(await lastTouch(), 'meta')).not.toBe(40 + 46 + 50); // 136
    });

    it('another tenant\'s newer row cannot be credited to this workspace', async () => {
      expect(conversionsOf(await lastTouch(), 'meta')).not.toBe(777);
    });

    it('the credited set is exactly the channel set — an orphan row reaches no output', async () => {
      // Stated precisely, because this is NOT what guards the entity narrowing.
      // Attribution's output map is keyed off the CHANNEL LIST, so a row for an
      // entity blended truth never returned has nowhere to land even if the
      // query fetched it. Dropping `entityIds` is therefore output-neutral HERE
      // and is caught by the query assertions and by the cross-service query
      // equality below — not by these figures. Economics is where that same
      // mutation moves a number, which is why R3.4 was the right place to
      // introduce the option.
      const result = await lastTouch();
      expect(result.channels.map((c) => c.channelId).sort()).toEqual(['google', 'meta', 'tiktok']);
      expect(result.channels.reduce((n, c) => n + (c.creditedConversions?.value ?? 0), 0))
        .toBe(EXPECTED_TOTAL);
    });

    it('a MANUAL reading is a stream of its own and is still not an acquisition', async () => {
      expect(conversionsOf(await lastTouch(), 'meta')).not.toBe(999);
    });

    it('an empty population credits zero — never an invented count', async () => {
      useTable([]);
      const result = await lastTouch();
      for (const id of Object.keys(EXPECTED_BY_CHANNEL)) {
        expect(conversionsOf(result, id)).toBe(0);
      }
    });
  });

  // ── the shared invariant, proven end-to-end ─────────────────────────────
  describe('Economics ↔ Attribution derive the same conversions', () => {
    it('Σ Attribution credited conversions === Economics totalConversions', async () => {
      // Both services run for real over the SAME table and the SAME channels.
      // Neither number is computed here; the test compares the two services'
      // own outputs, so it cannot pass by reproducing the reduction correctly
      // while the services reproduce it differently.
      const attributed = await lastTouch();
      const attrTotal = attributed.channels
        .reduce((n, c) => n + (c.creditedConversions?.value ?? 0), 0);

      const cac = await getCurrentCac(WS);

      expect(attrTotal).toBe(cac.totalConversions);
      expect(attrTotal).toBe(EXPECTED_TOTAL);
    });

    it('they issue the SAME evidence query — same population, not just the same reduction', async () => {
      // Sharing latestPerStream kept HOW the rows collapse in step. This is the
      // other half: which rows arrive at all.
      await lastTouch();
      const attrArgs = argsOf();
      vi.clearAllMocks();
      useTable();
      getBlendedTruth.mockResolvedValue({ channels: CHANNELS, portfolio: {} });
      await getCurrentCac(WS);
      expect(argsOf()).toEqual(attrArgs);
    });

    it('and still agree when the population is empty — both honest, neither invented', async () => {
      useTable([]);
      const attributed = await lastTouch();
      const attrTotal = attributed.channels
        .reduce((n, c) => n + (c.creditedConversions?.value ?? 0), 0);
      const cac = await getCurrentCac(WS);
      expect(attrTotal).toBe(0);
      expect(cac.totalConversions).toBe(0);
      expect(cac.currentBlendedCacMinor).toBeNull(); // not a free acquisition
    });
  });

  // ── everything the migration must NOT have altered ──────────────────────
  describe('the rest of the service is untouched', () => {
    it('buildAttributionInputs still folds channels, conversions and holdouts', () => {
      const { engineChannels, incrementality } = buildAttributionInputs(
        [chan('meta')],
        new Map([['meta', 42]]),
        [{ entityId: 'meta', _incrementalConversions: 9, confidenceLabel: 'HIGH', ciLow: 1, ciHigh: 2 }],
      );
      expect(engineChannels[0]).toMatchObject({ channelId: 'meta', conversions: 42, spendMinor: 100_000 });
      expect(incrementality.meta).toEqual({
        incrementalConversions: null, monetaryReason: 'INCREMENTAL_MONETARY_BASIS_UNPROVEN',
        observed: { exposedUsers: undefined, exposedConversions: undefined, holdoutUsers: undefined, holdoutConversions: undefined, liftPct: undefined },
        confidenceLabel: 'HIGH', ciLow: 1, ciHigh: 2,
      });
    });

    it('model selection still reaches the engine', async () => {
      const out = await getAttribution(WS, { model: ATTRIBUTION_MODEL.LAST_TOUCH });
      expect(out.model).toBe(ATTRIBUTION_MODEL.LAST_TOUCH);
    });

    it('no channels still short-circuits before any evidence read', async () => {
      getBlendedTruth.mockResolvedValue({ channels: [], portfolio: {} });
      const out = await getAttribution(WS);
      expect(out.status).toBe('INSUFFICIENT_DATA');
      expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
    });

    it('incrementality still comes from concluded holdouts and the AOV', async () => {
      prisma.incrementalityTest.findMany.mockResolvedValue([
        { entityId: 'meta', status: 'CONCLUDED', incrementalRevenueMinor: 90_000,
          confidenceLabel: 'HIGH', ciLow: 0.1, ciHigh: 0.3 },
      ]);
      const out = await getAttribution(WS, { model: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED });
      expect(prisma.incrementalityTest.findMany).toHaveBeenCalledWith(
        { where: { workspaceId: WS, status: 'CONCLUDED' } },
      );
      expect(out.status).not.toBe('INSUFFICIENT_DATA');
    });

    it('PathTouch is still read, still capped, still workspace-scoped', async () => {
      await lastTouch();
      expect(prisma.pathTouch.findMany).toHaveBeenCalledWith({
        where:  { workspaceId: WS },
        select: { conversionId: true, channel: true, touchPosition: true },
        take:   5000,
      });
    });

    it('economics is still a dependency of the attribution call', async () => {
      await lastTouch();
      expect(prisma.accountEconomics.findUnique).toHaveBeenCalledWith({ where: { workspaceId: WS } });
    });
  });

  // ── isolation and failure ───────────────────────────────────────────────
  describe('isolation and failure', () => {
    it('cannot read across workspaces', async () => {
      await lastTouch();
      expect(argsOf().where.workspaceId).toBe(WS);
      await expect(getAttribution(null)).rejects.toThrow(/workspaceId required/);
    });

    // ── B5-01T′ — THE INVERTED CONTRACT ───────────────────────────────────
    //
    // This assertion used to read:
    //
    //   it('degrades a failed read to zero conversions — preserved', …)
    //     expect(conversionsOf(result, id)).toBe(0);
    //
    // It passed, it was deliberate, and it was wrong. A dead database does not
    // establish that a platform reported zero conversions — and the wrapper said
    // it did: `{ value: 0, source: PLATFORM, confidence: MEDIUM }`. Zero
    // conversions at medium confidence is not a missing number, it is a
    // confident wrong one, and it is the reading that gets a channel killed.
    //
    // The old test is not kept alongside this one. Two tests asserting opposite
    // things about the same input is not history, it is an unresolved argument.
    it('T1 — a failed conversion read yields NULL, never a fabricated zero', async () => {
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      const result = await lastTouch();

      for (const id of Object.keys(EXPECTED_BY_CHANNEL)) {
        const f = result.channels.find((r) => r.channelId === id).creditedConversions;
        expect(f.value, 'a failed read must not produce a number').toBeNull();
        expect(f.value).not.toBe(0);
        // I3 — provenance may not name a source that returned nothing.
        expect(f.source).toBe('UNAVAILABLE');
        expect(f.source).not.toBe('PLATFORM');
        // T6 — and may not claim a confidence a successful read never gave it.
        expect(f.confidence).toBe('UNKNOWN');
        expect(['MEDIUM', 'HIGH', 'LOW']).not.toContain(f.confidence);
        expect(f.status).toBe('UNAVAILABLE');
        expect(f.reason).toBe('CONVERSION_EVIDENCE_UNAVAILABLE');
      }
      // …and the response must not look complete.
      expect(result.status).toBe('EVIDENCE_UNAVAILABLE');
      expect(result.evidence.conversions).toBe('UNAVAILABLE');
    });

    it('T2 — a SUCCESSFUL empty read keeps its existing meaning', async () => {
      // The separation that makes T1 meaningful rather than merely stricter.
      // `resolve([])` is a statement about the account: it synced nothing, so
      // zero conversions is the true answer and PLATFORM is the true source.
      // Only `reject()` is a statement about us.
      useTable([]);
      const result = await lastTouch();

      for (const id of Object.keys(EXPECTED_BY_CHANNEL)) {
        const f = result.channels.find((r) => r.channelId === id).creditedConversions;
        expect(f.value, 'an empty account still has a real zero').toBe(0);
        expect(f.source).toBe('PLATFORM');
        expect(f.status).toBe('OK');
      }
      expect(result.status).toBe('OK');
      expect(result.evidence.conversions).toBe('OK');
    });

    it('T5 — revenue that WAS read survives a failed conversion read', async () => {
      // Partial, not blanked. Blended truth answered, so its numbers are real and
      // stay visible; only the column whose evidence died goes dark.
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      const result = await lastTouch();

      const meta = result.channels.find((r) => r.channelId === 'meta');
      expect(meta.creditedRevenueMinor.value).not.toBeNull();
      expect(meta.creditedRevenueMinor.source).toBe('PLATFORM');
      expect(meta.creditedRevenueMinor.status).toBe('OK');
      expect(meta.creditedConversions.value).toBeNull();
      expect(result.evidence).toEqual({
        conversions: 'UNAVAILABLE', incrementality: 'OK', paths: 'OK',
      });
    });

    it('T3 — a failed holdout read is never reported as "no holdout"', async () => {
      // I6. The two are not the same fact, and the caveat is where a user reads
      // which one happened.
      prisma.incrementalityTest.findMany.mockRejectedValue(new Error('db down'));
      const result = await getAttribution(WS, { model: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED });

      expect(result.evidence.incrementality).toBe('UNAVAILABLE');
      expect(result.status).toBe('EVIDENCE_UNAVAILABLE');
      for (const row of result.channels) {
        expect(row.creditedRevenueMinor.caveat).not.toMatch(/no holdout test on this channel/);
        expect(row.creditedRevenueMinor.caveat).toMatch(/could not be read/);
      }
      // Conversions were readable, so they are still real — one dead read does
      // not darken the other two.
      expect(conversionsOf(result, 'meta')).toBe(EXPECTED_BY_CHANNEL.meta);
    });

    it('T3b — a SUCCESSFUL empty holdout read still says "no holdout"', async () => {
      prisma.incrementalityTest.findMany.mockResolvedValue([]);
      const result = await getAttribution(WS, { model: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED });

      expect(result.evidence.incrementality).toBe('OK');
      expect(result.status).toBe('OK');
      expect(result.channels[0].creditedRevenueMinor.caveat).toMatch(/no holdout test on this channel/);
    });

    it('T4 — a failed path read is never reported as "no path data connected"', async () => {
      // The worst of the three to get wrong: the old text told an operator to go
      // connect a journey source, which is a task list item produced by an outage.
      prisma.pathTouch.findMany.mockRejectedValue(new Error('db down'));
      const result = await getAttribution(WS, { model: ATTRIBUTION_MODEL.LINEAR });

      expect(result.status).toBe('EVIDENCE_UNAVAILABLE');
      expect(result.reason).toBe('PATH_EVIDENCE_UNAVAILABLE');
      expect(result.reason).not.toMatch(/connect a journey source/);
      expect(result.evidence.paths).toBe('UNAVAILABLE');
    });

    it('T4b — a SUCCESSFUL empty path read still says the model is dark', async () => {
      prisma.pathTouch.findMany.mockResolvedValue([]);
      const result = await getAttribution(WS, { model: ATTRIBUTION_MODEL.LINEAR });

      expect(result.status).toBe('INSUFFICIENT_DATA');
      expect(result.reason).toMatch(/no path data connected/);
      expect(result.evidence.paths).toBe('OK');
    });

    it('no fabricated zero can reach the payload from ANY failed read', async () => {
      // The whole matrix at once, as a closing net: whatever combination of the
      // three reads dies, a credited figure is either real or null — never 0
      // wearing a source label.
      for (const dead of ['metricSnapshot', 'incrementalityTest', 'pathTouch']) {
        vi.clearAllMocks();
        getBlendedTruth.mockResolvedValue({ channels: CHANNELS, portfolio: {} });
        useTable();
        prisma.incrementalityTest.findMany.mockResolvedValue([]);
        prisma.pathTouch.findMany.mockResolvedValue([]);
        prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
        prisma.accountEconomics.findUnique.mockResolvedValue({
          workspaceId: WS, currency: 'USD', aovMinor: 10_000, grossMarginPct: 0.6,
          repeatRate: 0, avgOrdersPerCustomer: 2, targetLtvToCac: 3,
        });
        prisma[dead].findMany.mockRejectedValue(new Error('db down'));

        const result = await getAttribution(WS, { model: ATTRIBUTION_MODEL.INCREMENTALITY_WEIGHTED });
        expect(result.status, `${dead} down`).toBe('EVIDENCE_UNAVAILABLE');
        for (const row of result.channels ?? []) {
          for (const f of [row.creditedConversions, row.creditedRevenueMinor]) {
            if (f.status === 'UNAVAILABLE') {
              expect(f.value, `${dead} down`).toBeNull();
              expect(f.source, `${dead} down`).toBe('UNAVAILABLE');
            }
          }
        }
      }
    });

    it('the seam itself still refuses to swallow — the catch is Attribution\'s own', async () => {
      const { selectOperationalSnapshots } = await import('../evidence/index.js');
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      await expect(selectOperationalSnapshots(WS, { select: PRE_MIGRATION_SELECT }))
        .rejects.toThrow('db down');
    });
  });
});
