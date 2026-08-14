// ============================================================
// R3 — the operational population, as a policy
// ============================================================
// This file tests the Evidence layer's side of the guardrail migration: that
// "operational" means one specific thing, that it means it in the query rather
// than in a caller's loop, and that it refuses the two shapes which would make
// it quietly wrong (an unscoped read and an unprojected one).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { metricSnapshot: { findMany: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import { selectOperationalSnapshots, OPERATIONAL_ORDER_BY } from './operationalEvidence.js';
import { OPERATIONAL_WINDOW_FILTER, MEASUREMENT_WINDOW } from '../connectors/connectorTypes.js';

const SELECT = { entityId: true, date: true };
const WS = 'ws-1';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
});

const argsOf = () => prisma.metricSnapshot.findMany.mock.calls[0][0];

describe('R3 — operational evidence', () => {
  describe('the population it selects', () => {
    it('scopes to the workspace it was given', async () => {
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().where.workspaceId).toBe(WS);
    });

    it('admits only the operational measurement windows', async () => {
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().where.measurementWindow).toBe(OPERATIONAL_WINDOW_FILTER);
      // The allow-list itself: canonical rows are a different population and are
      // answered by a different selector, never by widening this one.
      expect(OPERATIONAL_WINDOW_FILTER.in).toContain(MEASUREMENT_WINDOW.LEGACY_UNKNOWN);
      expect(OPERATIONAL_WINDOW_FILTER.in).toContain(MEASUREMENT_WINDOW.ROLLING_WINDOW);
      expect(OPERATIONAL_WINDOW_FILTER.in).not.toContain(MEASUREMENT_WINDOW.CUMULATIVE_30D);
      expect(OPERATIONAL_WINDOW_FILTER.in).not.toContain(MEASUREMENT_WINDOW.DAILY);
    });

    it('bounds `date` — the SYNC timestamp — and never windowStart/windowEnd', async () => {
      const since = new Date('2026-08-01T00:00:00Z');
      await selectOperationalSnapshots(WS, { since, select: SELECT });
      expect(argsOf().where.date).toEqual({ gte: since });
      // Moving to windowStart would silently reinterpret the bound as a delivery
      // period. R2 named the distinction; R3 must not erase it.
      expect(argsOf().where.windowStart).toBeUndefined();
      expect(argsOf().where.windowEnd).toBeUndefined();
    });

    it('omits the date bound entirely when no `since` is given', async () => {
      await selectOperationalSnapshots(WS, { select: SELECT });
      expect(argsOf().where.date).toBeUndefined();
    });

    it('returns oldest-first', async () => {
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().orderBy).toEqual({ date: 'asc' });
      expect(OPERATIONAL_ORDER_BY).toEqual({ date: 'asc' });
    });

    it('omits orderBy ENTIRELY when the caller passes null', async () => {
      // Not `orderBy: null` — that is a value handed to Prisma. A consumer whose
      // engine sorts for itself never asked the database to sort, and the only
      // faithful reproduction of that query is the absent clause.
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT, orderBy: null });
      expect(argsOf()).not.toHaveProperty('orderBy');
      expect(Object.keys(argsOf()).sort()).toEqual(['select', 'where']);
    });

    it('honours an explicit ordering when one is given', async () => {
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT, orderBy: { date: 'desc' } });
      expect(argsOf().orderBy).toEqual({ date: 'desc' });
    });

    it('passes the caller projection through untouched', async () => {
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().select).toBe(SELECT);
    });
  });

  // ── entityIds (R3.4) ──────────────────────────────────────────────────────
  //
  // A narrowing, not a population change. Economics and Attribution have always
  // asked about exactly the channels blended truth returned; the predicate moved
  // here rather than being replaced by a workspace-wide read filtered in memory,
  // which would be a different query wearing the same result.
  describe('the optional entity narrowing', () => {
    it('omits the predicate ENTIRELY when no entityIds are given', async () => {
      // The whole reason the seam may grow during a behaviour-preserving
      // migration: a narrowing nobody passes must be indistinguishable from a
      // narrowing that does not exist. Guardrail, Pattern and BlendedTruth were
      // migrated before this option existed and must not notice it now.
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().where.entityId).toBeUndefined();
      expect(Object.keys(argsOf().where).sort()).toEqual(['date', 'measurementWindow', 'workspaceId']);
    });

    it('narrows to the given entities', async () => {
      await selectOperationalSnapshots(WS, { select: SELECT, entityIds: ['e1', 'e2'] });
      expect(argsOf().where.entityId).toEqual({ in: ['e1', 'e2'] });
      expect(Object.keys(argsOf().where).sort()).toEqual(['entityId', 'measurementWindow', 'workspaceId']);
    });

    it('an EMPTY list matches nothing — it does not widen to the workspace', async () => {
      // `[]` means "these zero entities". Treating it as absent would turn a
      // scoped read into a workspace-wide one at exactly the moment the caller
      // had nothing to ask about, which is the direction that leaks rows.
      await selectOperationalSnapshots(WS, { select: SELECT, entityIds: [] });
      expect(argsOf().where.entityId).toEqual({ in: [] });
    });

    it('narrowing never relaxes the population or the workspace scope', async () => {
      await selectOperationalSnapshots(WS, { select: SELECT, entityIds: ['e1'] });
      expect(argsOf().where.workspaceId).toBe(WS);
      expect(argsOf().where.measurementWindow).toBe(OPERATIONAL_WINDOW_FILTER);
    });

    it('composes with `since` rather than replacing it', async () => {
      const since = new Date('2026-08-01T00:00:00Z');
      await selectOperationalSnapshots(WS, { since, select: SELECT, entityIds: ['e1'] });
      expect(argsOf().where.date).toEqual({ gte: since });
      expect(argsOf().where.entityId).toEqual({ in: ['e1'] });
    });
  });

  // ── entityLevel (R3.8) ────────────────────────────────────────────────────
  //
  // The second narrowing, added on the same terms as the first: RevenueCsv has
  // always asked for CAMPAIGN rows only, and EntityGraph reads one level at a
  // time. Neither is a claim about which rows are operational — the population
  // spans every level and still does — so the tests below are mostly about the
  // ABSENCE of the key, which is what every consumer migrated before R3.8 needs.
  describe('the optional entity-level narrowing', () => {
    it('omits the predicate ENTIRELY when no entityLevel is given', async () => {
      // Guardrail, Pattern, BlendedTruth, Economics, Attribution, Plan and
      // TestGenerator were all migrated before this option existed. If it ever
      // acquires a default, their queries change underneath them and this is
      // where that shows up.
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().where.entityLevel).toBeUndefined();
      expect(Object.keys(argsOf().where).sort()).toEqual(['date', 'measurementWindow', 'workspaceId']);
    });

    it('the key is ABSENT, not present-and-null', async () => {
      // Prisma reads `entityLevel: null` as "level IS NULL" and would match
      // nothing. `hasOwnProperty` is the assertion, because `undefined` and
      // absent are indistinguishable to the dot-access above.
      await selectOperationalSnapshots(WS, { select: SELECT });
      expect(Object.prototype.hasOwnProperty.call(argsOf().where, 'entityLevel')).toBe(false);
      await selectOperationalSnapshots(WS, { select: SELECT, entityLevel: null });
      const second = prisma.metricSnapshot.findMany.mock.calls[1][0];
      expect(Object.prototype.hasOwnProperty.call(second.where, 'entityLevel')).toBe(false);
    });

    it('narrows to the given level', async () => {
      await selectOperationalSnapshots(WS, { select: SELECT, entityLevel: 'CAMPAIGN' });
      expect(argsOf().where.entityLevel).toBe('CAMPAIGN');
      expect(Object.keys(argsOf().where).sort()).toEqual(['entityLevel', 'measurementWindow', 'workspaceId']);
    });

    it('narrowing never relaxes the population or the workspace scope', async () => {
      await selectOperationalSnapshots(WS, { select: SELECT, entityLevel: 'ADSET' });
      expect(argsOf().where.workspaceId).toBe(WS);
      expect(argsOf().where.measurementWindow).toBe(OPERATIONAL_WINDOW_FILTER);
    });

    it('composes with entityIds and `since` rather than replacing either', async () => {
      const since = new Date('2026-08-01T00:00:00Z');
      await selectOperationalSnapshots(WS, {
        since, select: SELECT, entityIds: ['e1'], entityLevel: 'CAMPAIGN',
      });
      expect(argsOf().where).toEqual({
        workspaceId: WS,
        date: { gte: since },
        entityId: { in: ['e1'] },
        entityLevel: 'CAMPAIGN',
        measurementWindow: OPERATIONAL_WINDOW_FILTER,
      });
    });

    it('is never inferred from entityIds', async () => {
      // An id list is single-level today by accident of who calls it, not by
      // contract. Deriving the level from it would turn a caller's silence into
      // a filter it never wrote.
      await selectOperationalSnapshots(WS, { select: SELECT, entityIds: ['e1', 'e2'] });
      expect(argsOf().where.entityLevel).toBeUndefined();
    });
  });

  // ── distinct + take (R3.10) ───────────────────────────────────────────────
  //
  // The seam's most dangerous option pair, and the tests are weighted
  // accordingly: almost all of them are about the options being ABSENT. Plan's
  // entity scan asks "which entities has this workspace synced anything for",
  // caps the answer at 50, and is the only caller that may name either key.
  describe('the optional reduction', () => {
    it('omits BOTH keys entirely when neither is given', async () => {
      // The contract in one assertion. Six earlier R3 PRs used `distinct` at
      // this seam as a negative control; if it ever acquires a default, all of
      // them start passing against a broken seam.
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(Object.keys(argsOf()).sort()).toEqual(['orderBy', 'select', 'where']);
    });

    it('the keys are ABSENT, not present-and-null', async () => {
      // `distinct: null` / `take: null` are values Prisma reads, so `undefined`
      // via dot-access is not enough — the keys must not exist.
      await selectOperationalSnapshots(WS, { select: SELECT, distinct: null, take: null });
      const a = argsOf();
      expect(Object.prototype.hasOwnProperty.call(a, 'distinct')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(a, 'take')).toBe(false);
    });

    it('passes a reduction through when one is asked for', async () => {
      await selectOperationalSnapshots(WS, {
        select: { entityId: true }, orderBy: null, distinct: ['entityId'], take: 50,
      });
      expect(argsOf().distinct).toEqual(['entityId']);
      expect(argsOf().take).toBe(50);
      expect(Object.keys(argsOf()).sort()).toEqual(['distinct', 'select', 'take', 'where']);
    });

    it('each is independent of the other', async () => {
      await selectOperationalSnapshots(WS, { select: SELECT, take: 5 });
      expect(argsOf().take).toBe(5);
      expect(Object.prototype.hasOwnProperty.call(argsOf(), 'distinct')).toBe(false);
    });

    it('take: 0 survives — it is a cap, not a missing value', async () => {
      // `== null` rather than truthiness, for the same reason `entityIds: []`
      // survives: "cap this at zero" is a thing a caller can mean, and reading
      // it as "no cap" would widen the read at the moment it was narrowest.
      await selectOperationalSnapshots(WS, { select: SELECT, take: 0 });
      expect(argsOf().take).toBe(0);
    });

    it('reduction never relaxes the population or the workspace scope', async () => {
      await selectOperationalSnapshots(WS, { select: SELECT, distinct: ['entityId'], take: 50 });
      expect(argsOf().where.workspaceId).toBe(WS);
      expect(argsOf().where.measurementWindow).toBe(OPERATIONAL_WINDOW_FILTER);
    });
  });

  describe('what it deliberately does NOT do', () => {
    it('applies no source filter — actual-revenue rows stay in the population', async () => {
      // GA4/SHOPIFY/MANUAL are eligible operational rows today. Importing the
      // canonical verdict allow-list here would drop them out of every consumer.
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().where.source).toBeUndefined();
    });

    it('applies no entityLevel filter OF ITS OWN — every level stays eligible', async () => {
      // R3.8 made this a caller's option; it did not make it a policy. The seam
      // narrows by level only when asked, and the default population is still
      // every level in the workspace.
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().where.entityLevel).toBeUndefined();
    });

    it('is not a query builder — an option it does not NAME never reaches Prisma', async () => {
      // The architectural guard. Every option this seam accepts was added by a
      // PR that said which consumer needed it and why; a generic `where` bag or
      // a `...opts` spread would end that, and the operational policy would
      // become a default callers are free to talk out of. Written as behaviour
      // rather than a source grep so it fails on the passthrough, not the syntax.
      await selectOperationalSnapshots(WS, {
        select: SELECT,
        where:   { source: 'META', measurementWindow: { equals: 'CUMULATIVE_30D' } },
        skip:    10,
        cursor:  { id: 'x' },
        include: { campaign: true },
        distinctBy: ['source'],
      });
      const a = argsOf();
      expect(Object.keys(a).sort()).toEqual(['orderBy', 'select', 'where']);
      expect(Object.keys(a.where).sort()).toEqual(['measurementWindow', 'workspaceId']);
      expect(a.where.measurementWindow).toBe(OPERATIONAL_WINDOW_FILTER); // not the smuggled one
      expect(a.where.source).toBeUndefined();
    });

    it('performs no latest-per-entity reduction BY DEFAULT — the full series is returned', async () => {
      const rows = [
        { entityId: 'e1', date: new Date('2026-08-01') },
        { entityId: 'e1', date: new Date('2026-08-02') },
        { entityId: 'e1', date: new Date('2026-08-03') },
      ];
      prisma.metricSnapshot.findMany.mockResolvedValue(rows);
      const out = await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(out).toHaveLength(3);
      expect(argsOf().distinct).toBeUndefined();
    });

    it('issues exactly ONE query, even when the population is empty', async () => {
      // THE ONLY WAY A FALLBACK IS VISIBLE. An evidence fallback that reads a
      // second population when the first comes back empty returns the same
      // `[]`-shaped result as no fallback at all, and every assertion about the
      // FIRST call's arguments still passes. A second read is the only trace it
      // leaves, so the count is the assertion.
      prisma.metricSnapshot.findMany.mockResolvedValue([]);
      const out = await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(out).toEqual([]);
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    });

    it('returns the empty population rather than widening to canonical (I4, both directions)', async () => {
      prisma.metricSnapshot.findMany.mockResolvedValue([]);
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      for (const call of prisma.metricSnapshot.findMany.mock.calls) {
        expect(call[0].where.measurementWindow).toBe(OPERATIONAL_WINDOW_FILTER);
      }
    });

    it('does not swallow a read failure', async () => {
      // The guardrail sweep this was extracted from let the error propagate.
      // Catching here would turn an unreachable database into "no metrics", and
      // the sweep would report a clean run over an empty series.
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      await expect(selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT }))
        .rejects.toThrow('db down');
    });
  });

  describe('it refuses to be used unsafely', () => {
    it('throws without a workspaceId rather than reading across workspaces', async () => {
      await expect(selectOperationalSnapshots(null, { select: SELECT })).rejects.toThrow(/workspaceId required/);
      await expect(selectOperationalSnapshots('', { select: SELECT })).rejects.toThrow(/workspaceId required/);
      expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
    });

    it('ignores a workspaceId smuggled through the options object (I2)', async () => {
      // The trusted scope is the POSITIONAL argument, supplied by middleware or
      // by a worker iterating workspaces. An options bag is the shape a request
      // body arrives in, so if anything in it could override the scope, one
      // forwarded field would read another tenant's rows. The positional
      // argument must win, and an unknown key must not reach the query.
      await selectOperationalSnapshots(WS, {
        since: new Date(0), select: SELECT, workspaceId: 'ws-attacker',
      });
      expect(argsOf().where.workspaceId).toBe(WS);
      expect(JSON.stringify(argsOf())).not.toContain('ws-attacker');
    });

    it('throws without a projection rather than widening silently', async () => {
      await expect(selectOperationalSnapshots(WS, { since: new Date(0) })).rejects.toThrow(/select required/);
      expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
    });
  });
});
