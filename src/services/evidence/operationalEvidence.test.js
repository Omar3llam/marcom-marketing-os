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

  describe('what it deliberately does NOT do', () => {
    it('applies no source filter — actual-revenue rows stay in the population', async () => {
      // GA4/SHOPIFY/MANUAL are eligible operational rows today. Importing the
      // canonical verdict allow-list here would drop them out of every consumer.
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().where.source).toBeUndefined();
    });

    it('applies no entityLevel filter — every level stays eligible', async () => {
      await selectOperationalSnapshots(WS, { since: new Date(0), select: SELECT });
      expect(argsOf().where.entityLevel).toBeUndefined();
    });

    it('performs no latest-per-entity reduction — the full series is returned', async () => {
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
