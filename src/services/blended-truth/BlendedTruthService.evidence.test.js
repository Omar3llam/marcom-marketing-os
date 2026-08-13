// ============================================================
// R3.3 — BlendedTruth migrated onto the Evidence seam
// ============================================================
// A separate file from BlendedTruthService.test.js, which is deliberately
// DB-free and tests the pure functions. This one owns the DB seam.
//
// BlendedTruth is the consumer that makes the shared selector's ABSENCE of a
// source filter load-bearing. Reconciliation only means anything because GA4,
// SHOPIFY and MANUAL rows arrive beside the platform rows. A canonical-style
// allow-list would not narrow this population — it would delete the actual half
// of platform-vs-actual, and every account would report a perfect zero gap
// while looking entirely healthy. Nothing would throw.
//
// So the parity proof here is not only "the query args match". It is that the
// RECONCILED OUTPUT still distinguishes platform truth from actual truth, on a
// fixture built so that losing the actual rows changes the answer.
//
// The engine (`reconcile`) is deliberately kept REAL — stubbing it would move
// the assertion off the thing being protected.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    metricSnapshot: { findMany: vi.fn() },
    campaign:       { findMany: vi.fn() },
    workspace:      { findUnique: vi.fn() },
  },
}));
vi.mock('../connectors/credentialStore.js', () => ({ listConnections: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { listConnections } from '../connectors/credentialStore.js';
import { getBlendedTruth } from './BlendedTruthService.js';
import { OPERATIONAL_WINDOW_FILTER } from '../connectors/connectorTypes.js';
import { TEMPORAL } from '../../config/temporal.js';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'BlendedTruthService.js'),
  'utf8',
);

const WS = 'ws-blended';

// The exact projection the pre-migration query used — six fields.
const PRE_MIGRATION_SELECT = {
  entityId: true, date: true, source: true, revenueMinor: true, spendMinor: true, currency: true,
};

const row = (over = {}) => ({
  entityId: 'c1', date: new Date('2026-08-10T00:00:00Z'), source: 'META',
  revenueMinor: 0, spendMinor: 0, currency: 'USD', ...over,
});

// One campaign, two measurement streams: META claims 10 000, GA4 measures 6 000.
// Spend 5 000. If the ACTUAL row is ever dropped from the population the channel
// silently becomes "unverified", blended collapses onto the platform claim, and
// the 4 000 gap disappears — which is exactly what a source allow-list would do.
const PLATFORM_AND_ACTUAL = [
  row({ source: 'META', spendMinor: 5_000, revenueMinor: 10_000 }),
  row({ source: 'GA4',  revenueMinor: 6_000 }),
];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
  prisma.campaign.findMany.mockResolvedValue([{ id: 'c1', name: 'Summer', channel: 'META' }]);
  prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
  listConnections.mockResolvedValue([]);
});

const evidenceArgs = () => prisma.metricSnapshot.findMany.mock.calls[0][0];

describe('R3.3 — BlendedTruthService on the Evidence seam', () => {
  // ── ownership ────────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('contains no direct MetricSnapshot query (I14)', () => {
      expect(SRC).not.toMatch(/prisma\s*\.\s*metricSnapshot/);
      expect(SRC).toMatch(/selectOperationalSnapshots/);
      // Its own reads stay its own — I14 is about MetricSnapshot alone.
      expect(SRC).toMatch(/prisma\.campaign\.findMany/);
      expect(SRC).toMatch(/prisma\.workspace\.findUnique/);
    });

    it('states no population of its own any more', () => {
      expect(SRC).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
      expect(SRC).not.toMatch(/measurementWindow/);
    });

    it('keeps latestPerStream in the service, not the Evidence layer', () => {
      // #357's reduction is reconciliation logic, not population policy. Moving
      // it would change what every other consumer of the seam receives.
      expect(SRC).toMatch(/export function latestPerStream/);
      expect(SRC).toMatch(/latestPerStream\(snapshots\)/);
    });
  });

  // ── A · query parity ─────────────────────────────────────────────────────
  describe('query parity with the pre-migration read', () => {
    it('issues exactly the pre-migration query', async () => {
      const before = Date.now();
      await getBlendedTruth(WS);
      const after = Date.now();
      const args = evidenceArgs();

      expect(args.select).toEqual(PRE_MIGRATION_SELECT);
      expect(args.where.workspaceId).toBe(WS);
      expect(args.where.measurementWindow).toEqual(OPERATIONAL_WINDOW_FILTER);

      const days = TEMPORAL.blendedTruthSyncRecencyDays;
      const gte = args.where.date.gte.getTime();
      expect(gte).toBeGreaterThanOrEqual(before - days * 86_400_000);
      expect(gte).toBeLessThanOrEqual(after - days * 86_400_000);

      // Nothing added, nothing dropped.
      expect(Object.keys(args.where).sort()).toEqual(['date', 'measurementWindow', 'workspaceId']);
      expect(Object.keys(args).sort()).toEqual(['select', 'where']);
    });

    it('carries NO orderBy — the key must be absent', async () => {
      // latestPerStream is documented order-independent precisely so no caller
      // needs an ORDER BY. This query never had one.
      await getBlendedTruth(WS);
      expect(evidenceArgs()).not.toHaveProperty('orderBy');
    });

    it('applies no source filter — the actual half of the reconciliation survives', async () => {
      await getBlendedTruth(WS);
      expect(evidenceArgs().where.source).toBeUndefined();
    });

    it('bounds sync recency on `date`, never windowStart/windowEnd', async () => {
      await getBlendedTruth(WS);
      expect(evidenceArgs().where.date).toBeDefined();
      expect(evidenceArgs().where.windowStart).toBeUndefined();
      expect(evidenceArgs().where.windowEnd).toBeUndefined();
    });

    it('adds no reduction at the Evidence layer', async () => {
      await getBlendedTruth(WS);
      expect(evidenceArgs().distinct).toBeUndefined();
      expect(evidenceArgs().take).toBeUndefined();
    });
  });

  // ── caller contract ──────────────────────────────────────────────────────
  describe('caller-supplied lookbackDays stays authoritative', () => {
    it('uses the caller value, not the 30-day default', async () => {
      const before = Date.now();
      await getBlendedTruth(WS, { lookbackDays: 17 });
      const after = Date.now();
      const gte = evidenceArgs().where.date.gte.getTime();
      expect(gte).toBeGreaterThanOrEqual(before - 17 * 86_400_000);
      expect(gte).toBeLessThanOrEqual(after - 17 * 86_400_000);
      // And is genuinely not the default that happens to pass.
      expect(gte).toBeGreaterThan(after - TEMPORAL.blendedTruthSyncRecencyDays * 86_400_000);
    });

    it('falls back to the configured default when the caller supplies none', async () => {
      expect(TEMPORAL.blendedTruthSyncRecencyDays).toBe(30);
      const before = Date.now();
      await getBlendedTruth(WS);
      const gte = evidenceArgs().where.date.gte.getTime();
      expect(gte).toBeLessThanOrEqual(before - 29 * 86_400_000);
    });
  });

  // ── B · OUTPUT parity — the BlendedTruth-specific guard ──────────────────
  describe('reconciliation output parity', () => {
    it('platform and actual rows still reconcile into a real gap', async () => {
      prisma.metricSnapshot.findMany.mockResolvedValue(PLATFORM_AND_ACTUAL);
      const { channels, portfolio } = await getBlendedTruth(WS);

      expect(channels).toHaveLength(1);
      const c = channels[0];
      expect(c.channelId).toBe('c1');
      expect(c.name).toBe('Summer');
      expect(c.spendMinor).toBe(5_000);
      expect(c.platformRevenueMinor).toBe(10_000);   // META claim
      expect(c.actualRevenueMinor).toBe(6_000);      // GA4 measurement
      expect(c.blendedRevenueMinor).toBe(6_000);     // actual wins
      expect(c.gapMinor).toBe(4_000);                // platform over-reports
      expect(c.coverage).toBe('RECONCILED');

      expect(portfolio.reconciledCount).toBe(1);
      expect(portfolio.unverifiedCount).toBe(0);
      expect(portfolio.gapMinor).toBe(4_000);
    });

    it('losing the actual source would change the answer — which is why it must not be filtered', async () => {
      // The counterfactual, asserted explicitly: this is what a canonical source
      // allow-list would produce. Same platform row, no GA4 row.
      prisma.metricSnapshot.findMany.mockResolvedValue([PLATFORM_AND_ACTUAL[0]]);
      const { channels, portfolio } = await getBlendedTruth(WS);
      expect(channels[0].actualRevenueMinor).toBeNull();
      expect(channels[0].blendedRevenueMinor).toBe(10_000); // collapses onto the claim
      expect(channels[0].gapMinor).toBe(0);                 // the gap vanishes
      expect(channels[0].coverage).toBe('UNVERIFIED');
      expect(portfolio.reconciledCount).toBe(0);
    });

    it('MANUAL revenue still reconciles as an actual, not a platform claim', async () => {
      prisma.metricSnapshot.findMany.mockResolvedValue([
        row({ source: 'META',   spendMinor: 2_000, revenueMinor: 9_000 }),
        row({ source: 'MANUAL', revenueMinor: 3_000 }),
      ]);
      const { channels } = await getBlendedTruth(WS);
      expect(channels[0].actualRevenueMinor).toBe(3_000);
      expect(channels[0].blendedRevenueMinor).toBe(3_000);
      expect(channels[0].coverage).toBe('RECONCILED');
    });

    it('latest-per-stream still supersedes rather than sums', async () => {
      // Overlapping trailing-window aggregates (#359). If the migration had
      // introduced a reduction at the Evidence layer, or dropped this one, the
      // spend would read 2 735 instead of 925.
      prisma.metricSnapshot.findMany.mockResolvedValue([
        row({ date: new Date('2026-08-01'), spendMinor: 900 }),
        row({ date: new Date('2026-08-02'), spendMinor: 910 }),
        row({ date: new Date('2026-08-03'), spendMinor: 925 }),
      ]);
      const { channels } = await getBlendedTruth(WS);
      expect(channels[0].spendMinor).toBe(925);
      expect(channels[0].spendMinor).not.toBe(2_735);
    });

    it('no snapshots yields an honest empty portfolio, not invented numbers', async () => {
      prisma.metricSnapshot.findMany.mockResolvedValue([]);
      const { channels, portfolio } = await getBlendedTruth(WS);
      expect(channels).toEqual([]);
      expect(portfolio.spendMinor).toBe(0);
      expect(portfolio.reconciledCount).toBe(0);
    });
  });

  // ── isolation, fallback, failure ─────────────────────────────────────────
  describe('isolation, fallback and failure', () => {
    it('cannot read across workspaces', async () => {
      await getBlendedTruth(WS);
      expect(evidenceArgs().where.workspaceId).toBe(WS);
      await expect(getBlendedTruth(null)).rejects.toThrow(/workspaceId required/);
    });

    it('reads evidence exactly once — a fallback leaves no other trace', async () => {
      prisma.metricSnapshot.findMany.mockResolvedValue([]);
      await getBlendedTruth(WS);
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    });

    it('lets a read failure propagate rather than reporting a zero portfolio', async () => {
      // "The database is unreachable" and "this account reconciles to zero" are
      // different facts, and one of them is a number on a leadership screen.
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      await expect(getBlendedTruth(WS)).rejects.toThrow('db down');
    });
  });
});
