// ============================================================
// R3.2 — Pattern migrated onto the Evidence seam
// ============================================================
// Pattern's read differs from guardrail's in one way that matters, and the whole
// shape of this migration follows from it: PATTERN'S QUERY HAS NO `orderBy`.
//
// patternEngine.indexSnapshots sorts each entity's series itself, so the
// database was never asked to. Handing this consumer the operational selector's
// default ordering would add an ORDER BY to the widest lookback in the system
// (365 days) — no output would change, and the query plan would. R3 moves
// ownership; it does not touch the query.
//
// The parity assertions compare against a literal reconstruction of the
// pre-migration query rather than a shared helper. A helper would be rewritten
// alongside the code it is meant to check and pass by construction.
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
    metricSnapshot:     { findMany: vi.fn() },
    decision:           { findMany: vi.fn() },
    testExperiment:     { findMany: vi.fn() },
    outcomeSnapshot:    { findMany: vi.fn() },
    accountPattern:     { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    patternObservation: { createMany: vi.fn() },
    $transaction:       vi.fn(),
  },
}));

import { prisma } from '../../lib/prisma.js';
import { getBriefing } from './PatternService.js';
import { OPERATIONAL_WINDOW_FILTER } from '../connectors/connectorTypes.js';
import { TEMPORAL } from '../../config/temporal.js';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'PatternService.js'),
  'utf8',
);

const WS = 'ws-pattern';
const NOW = new Date('2026-08-13T00:00:00Z');

// The exact projection the pre-migration query used — six fields, the ones
// buildPatternInputs reads.
const PRE_MIGRATION_SELECT = {
  entityId: true, date: true, frequency: true, roas: true, ctr: true, spendMinor: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.testExperiment.findMany.mockResolvedValue([]);
  prisma.outcomeSnapshot.findMany.mockResolvedValue([]);
  prisma.accountPattern.findMany.mockResolvedValue([]);
  prisma.accountPattern.createMany.mockResolvedValue({ count: 0 });
  prisma.patternObservation.createMany.mockResolvedValue({ count: 0 });
  prisma.$transaction.mockResolvedValue([]);
});

const evidenceArgs = () => prisma.metricSnapshot.findMany.mock.calls[0][0];

describe('R3.2 — PatternService on the Evidence seam', () => {
  // ── ownership ────────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('contains no direct MetricSnapshot query (I14)', () => {
      expect(SRC).not.toMatch(/prisma\s*\.\s*metricSnapshot/);
      expect(SRC).toMatch(/selectOperationalSnapshots/);
      // Its own tables are still its own — I14 is about MetricSnapshot alone.
      expect(SRC).toMatch(/prisma\.decision\.findMany/);
      expect(SRC).toMatch(/prisma\.accountPattern/);
      expect(SRC).toMatch(/prisma\.testExperiment/);
    });

    it('states no population of its own any more', () => {
      expect(SRC).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
      expect(SRC).not.toMatch(/measurementWindow/);
    });
  });

  // ── population parity ────────────────────────────────────────────────────
  describe('population parity with the pre-migration query', () => {
    it('issues exactly the pre-migration query', async () => {
      await getBriefing(WS, { now: NOW });
      const args = evidenceArgs();

      expect(args.select).toEqual(PRE_MIGRATION_SELECT);
      expect(args.where.workspaceId).toBe(WS);
      expect(args.where.measurementWindow).toEqual(OPERATIONAL_WINDOW_FILTER);
      expect(args.where.date).toEqual({
        gte: new Date(NOW.getTime() - TEMPORAL.patternSyncRecencyDays * 86_400_000),
      });

      // Nothing added, nothing dropped.
      expect(Object.keys(args.where).sort()).toEqual(['date', 'measurementWindow', 'workspaceId']);
      expect(Object.keys(args).sort()).toEqual(['select', 'where']);
    });

    it('carries NO orderBy — the key must be absent, not null', async () => {
      // THE PATTERN-SPECIFIC INVARIANT. The engine sorts its own series, so this
      // query never ordered; acquiring one would change the plan on a 365-day
      // scan. `orderBy: null` would also be wrong — that is a value handed to
      // Prisma, not the absence of a clause.
      await getBriefing(WS, { now: NOW });
      expect(evidenceArgs()).not.toHaveProperty('orderBy');
      expect(Object.keys(evidenceArgs())).not.toContain('orderBy');
    });

    it('applies no source filter — actual-revenue rows stay eligible', async () => {
      await getBriefing(WS, { now: NOW });
      expect(evidenceArgs().where.source).toBeUndefined();
    });

    it('applies no entityLevel filter', async () => {
      await getBriefing(WS, { now: NOW });
      expect(evidenceArgs().where.entityLevel).toBeUndefined();
    });

    it('bounds sync recency on `date`, never windowStart/windowEnd', async () => {
      await getBriefing(WS, { now: NOW });
      expect(evidenceArgs().where.date).toBeDefined();
      expect(evidenceArgs().where.windowStart).toBeUndefined();
      expect(evidenceArgs().where.windowEnd).toBeUndefined();
    });
  });

  // ── the caller contract ──────────────────────────────────────────────────
  describe('caller-supplied lookbackDays stays authoritative', () => {
    it('uses the caller value, not the 365-day default', async () => {
      await getBriefing(WS, { now: NOW, lookbackDays: 17 });
      expect(evidenceArgs().where.date).toEqual({
        gte: new Date(NOW.getTime() - 17 * 86_400_000),
      });
      // Prove it is genuinely 17 and not the default that happens to pass.
      expect(evidenceArgs().where.date.gte).not.toEqual(
        new Date(NOW.getTime() - TEMPORAL.patternSyncRecencyDays * 86_400_000),
      );
    });

    it('falls back to the configured default when the caller supplies none', async () => {
      await getBriefing(WS, { now: NOW });
      expect(TEMPORAL.patternSyncRecencyDays).toBe(365);
      expect(evidenceArgs().where.date).toEqual({
        gte: new Date(NOW.getTime() - 365 * 86_400_000),
      });
    });

    it('the override reaches the Evidence layer, not just the service', async () => {
      // The value must survive the whole path: caller → getBriefing → selector →
      // query. Asserting on the query args is what proves the last hop.
      await getBriefing(WS, { now: NOW, lookbackDays: 3 });
      const gte = evidenceArgs().where.date.gte;
      expect((NOW.getTime() - gte.getTime()) / 86_400_000).toBe(3);
    });
  });

  // ── isolation, cardinality, failure ──────────────────────────────────────
  describe('isolation, cardinality and failure', () => {
    it('cannot read across workspaces', async () => {
      await getBriefing(WS, { now: NOW });
      expect(evidenceArgs().where.workspaceId).toBe(WS);
      await expect(getBriefing(null)).rejects.toThrow(/workspaceId required/);
    });

    it('performs no latest-per-entity reduction — every row survives', async () => {
      const rows = [
        { entityId: 'e1', date: new Date('2026-08-01'), frequency: 2, roas: 1, ctr: 0.01, spendMinor: 100 },
        { entityId: 'e1', date: new Date('2026-08-02'), frequency: 3, roas: 1, ctr: 0.01, spendMinor: 100 },
        { entityId: 'e1', date: new Date('2026-08-03'), frequency: 4, roas: 1, ctr: 0.01, spendMinor: 100 },
      ];
      prisma.metricSnapshot.findMany.mockResolvedValue(rows);
      await getBriefing(WS, { now: NOW });
      // The selector returns what the query returned; nothing collapses it.
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
      expect(evidenceArgs().distinct).toBeUndefined();
      expect(evidenceArgs().take).toBeUndefined();
    });

    it('reads evidence exactly once — a fallback would be invisible otherwise', async () => {
      // An evidence fallback that reads a second population when the first is
      // empty returns the same empty result and passes every argument assertion
      // above. A second read is the only trace it leaves.
      prisma.metricSnapshot.findMany.mockResolvedValue([]);
      await getBriefing(WS, { now: NOW });
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    });

    it('lets a read failure propagate rather than reporting no patterns', async () => {
      // "The database is unreachable" and "this account has no patterns yet" are
      // different facts, and only one of them is safe to show a user.
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      await expect(getBriefing(WS, { now: NOW })).rejects.toThrow('db down');
    });
  });

  // ── R6: outcomes are now a history, so this read has to say which one ──
  describe('the outcome read after supersession', () => {
    const withDecision = async () => {
      prisma.decision.findMany.mockResolvedValue([
        { id: 'dec-1', entityId: 'e1', entityLevel: 'CAMPAIGN', verdict: 'KILL', createdAt: NOW },
      ]);
      await getBriefing(WS, { now: NOW });
      return prisma.outcomeSnapshot.findMany.mock.calls[0][0];
    };

    it('reads only the CURRENT outcome of each decision', async () => {
      // Re-recording appends. Without this predicate a corrected result and the
      // result it corrected would arrive as two independent observations of the
      // same call, and the pattern would count one decision twice.
      const args = await withDecision();
      expect(args.where.supersededAt).toBeNull();
      expect(args.where.decisionId).toEqual({ in: ['dec-1'] });
    });

    it('stays workspace-scoped', async () => {
      expect((await withDecision()).where.workspaceId).toBe(WS);
    });

    it('names its projection — the four R6 columns must not widen it silently', async () => {
      // It was a SELECT *, which survived only because nothing had been added to
      // the table. An unprojected read on a freshly-migrated column is #209.
      expect((await withDecision()).select).toEqual({ decisionId: true, sustained: true });
    });

    it('does not read outcomes at all when there are no decisions', async () => {
      prisma.decision.findMany.mockResolvedValue([]);
      await getBriefing(WS, { now: NOW });
      expect(prisma.outcomeSnapshot.findMany).not.toHaveBeenCalled();
    });
  });
});
