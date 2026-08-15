// ============================================================
// R3 — Guardrail migrated onto the Evidence seam
// ============================================================
// The sweep had no test before this. It also had its own MetricSnapshot query,
// which is the thing being moved — so the tests that matter are the ones proving
// the POPULATION did not change while the OWNERSHIP did.
//
// The parity assertions deliberately compare against a literal reconstruction of
// the pre-migration query rather than against a helper. A helper would be
// rewritten alongside the code it is supposed to be checking, and the comparison
// would pass by construction; a literal has to be edited by hand, deliberately,
// by someone who has decided the population should change.
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
    guardrailRule:  { findMany: vi.fn() },
    decision:       { createMany: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { sweepGuardrails } from './GuardrailSweepService.js';
import { OPERATIONAL_WINDOW_FILTER } from '../connectors/connectorTypes.js';
import { TEMPORAL } from '../../config/temporal.js';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'GuardrailSweepService.js'),
  'utf8',
);

const WS = 'ws-guardrail';

// The exact projection the pre-migration query used. Nine columns: the six
// valuesFromSnapshot reads, plus date, plus the two grouping keys.
const PRE_MIGRATION_SELECT = {
  entityId: true, entityLevel: true, date: true,
  frequency: true, roas: true, ctr: true, cpaMinor: true, spendMinor: true, currency: true,
};

const RULE = {
  id: 'rule-1', name: 'Frequency ceiling', enabled: true, scopeLevel: 'ADSET',
  metric: 'frequency', comparator: 'GT', threshold: 3.0, sustainedDays: 2, emitVerdict: 'WATCH',
};

const snap = (over = {}) => ({
  entityId: 'e1', entityLevel: 'ADSET', date: new Date('2026-08-10T00:00:00Z'),
  frequency: 4.0, roas: 1.2, ctr: 0.01, cpaMinor: 500, spendMinor: 10_000, currency: 'EGP',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.guardrailRule.findMany.mockResolvedValue([RULE]);
  prisma.metricSnapshot.findMany.mockResolvedValue([]);
  prisma.decision.createMany.mockResolvedValue({ count: 0 });
});

const evidenceArgs = () => prisma.metricSnapshot.findMany.mock.calls[0][0];

describe('R3 — GuardrailSweepService on the Evidence seam', () => {
  // ── 1 + 8: ownership moved ───────────────────────────────────────────────
  describe('ownership', () => {
    it('contains no direct MetricSnapshot query (I14)', () => {
      expect(SRC).not.toMatch(/prisma\s*\.\s*metricSnapshot/);
      expect(SRC).toMatch(/selectOperationalSnapshots/);
      // It still owns its OWN tables — I14 is about MetricSnapshot alone.
      expect(SRC).toMatch(/prisma\.guardrailRule/);
      expect(SRC).toMatch(/prisma\.decision\.createMany/);
    });

    it('no longer imports the operational window filter directly', () => {
      // Stating the population is the Evidence layer's job now. A lingering
      // import is how a consumer half-migrates and nobody notices.
      expect(SRC).not.toMatch(/OPERATIONAL_WINDOW_FILTER/);
    });
  });

  // ── 2–7: population parity ───────────────────────────────────────────────
  describe('population parity with the pre-migration query', () => {
    it('issues exactly the pre-migration query', async () => {
      const before = Date.now();
      await sweepGuardrails(WS);
      const after = Date.now();

      const args = evidenceArgs();
      expect(args.select).toEqual(PRE_MIGRATION_SELECT);
      expect(args.orderBy).toEqual({ date: 'asc' });
      expect(args.where.workspaceId).toBe(WS);
      expect(args.where.measurementWindow).toEqual(OPERATIONAL_WINDOW_FILTER);

      // The recency bound, recomputed independently from the R2 config.
      const days = TEMPORAL.guardrailSyncRecencyDays;
      const gte = args.where.date.gte.getTime();
      expect(gte).toBeGreaterThanOrEqual(before - days * 86_400_000);
      expect(gte).toBeLessThanOrEqual(after - days * 86_400_000);

      // Nothing was added that the old query did not have.
      expect(Object.keys(args.where).sort()).toEqual(['date', 'measurementWindow', 'workspaceId']);
      expect(Object.keys(args).sort()).toEqual(['orderBy', 'select', 'where']);
    });

    it('reads evidence exactly once per sweep', async () => {
      // A second read is the only visible trace an evidence fallback leaves —
      // when the first population is empty, falling back returns the same shape
      // as not falling back, and every argument assertion above still passes.
      prisma.metricSnapshot.findMany.mockResolvedValue([]);
      await sweepGuardrails(WS);
      expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
    });

    it('bounds sync recency on `date`, never on windowStart/windowEnd', async () => {
      await sweepGuardrails(WS);
      expect(evidenceArgs().where.date).toBeDefined();
      expect(evidenceArgs().where.windowStart).toBeUndefined();
      expect(evidenceArgs().where.windowEnd).toBeUndefined();
    });

    it('keeps the sync-recency default at 14 days', () => {
      expect(TEMPORAL.guardrailSyncRecencyDays).toBe(14);
    });

    it('still applies no source filter — actual-revenue rows remain eligible', async () => {
      await sweepGuardrails(WS);
      expect(evidenceArgs().where.source).toBeUndefined();
    });

    it('still applies no entityLevel filter — scoping stays the rule engine\'s job', async () => {
      await sweepGuardrails(WS);
      expect(evidenceArgs().where.entityLevel).toBeUndefined();
    });

    it('cannot read across workspaces', async () => {
      await sweepGuardrails(WS);
      expect(evidenceArgs().where.workspaceId).toBe(WS);
      await expect(sweepGuardrails(null)).rejects.toThrow(/workspaceId required/);
    });

    it('lets a read failure propagate rather than sweeping an empty series', async () => {
      // A swallowed error would report a clean run over no metrics, and every
      // guardrail would silently stop firing.
      prisma.metricSnapshot.findMany.mockRejectedValue(new Error('db down'));
      await expect(sweepGuardrails(WS)).rejects.toThrow('db down');
    });
  });

  // ── 5: entity grain + series shape ───────────────────────────────────────
  describe('entity grain and series shape', () => {
    it('groups at entityId:entityLevel — a shared id at two levels is two entities', async () => {
      // The fixture is built so that MERGING the two levels changes the verdict,
      // rather than merely looking untidy. The ad set breaches on its own last
      // two points; the campaign row is later and healthy, so a collapsed grain
      // would make the last two points [4.5, 1.0], the sustain would break, and
      // the hit would silently disappear.
      prisma.metricSnapshot.findMany.mockResolvedValue([
        snap({ entityId: 'e1', entityLevel: 'ADSET',    date: new Date('2026-08-01'), frequency: 4.0 }),
        snap({ entityId: 'e1', entityLevel: 'ADSET',    date: new Date('2026-08-02'), frequency: 4.5 }),
        snap({ entityId: 'e1', entityLevel: 'CAMPAIGN', date: new Date('2026-08-03'), frequency: 1.0 }),
      ]);
      await sweepGuardrails(WS);

      const rows = prisma.decision.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(1);
      expect(rows[0].entityLevel).toBe('ADSET');
    });

    it('keeps the levels separate even when both breach', async () => {
      // The other direction: with the grain intact each level is independently
      // evaluated, so a rule scoped to CAMPAIGN sees the campaign's own series
      // and not the ad set's.
      prisma.guardrailRule.findMany.mockResolvedValue([
        RULE,
        { ...RULE, id: 'rule-2', name: 'Campaign ceiling', scopeLevel: 'CAMPAIGN' },
      ]);
      prisma.metricSnapshot.findMany.mockResolvedValue([
        snap({ entityId: 'e1', entityLevel: 'ADSET',    date: new Date('2026-08-01'), frequency: 4.0 }),
        snap({ entityId: 'e1', entityLevel: 'ADSET',    date: new Date('2026-08-02'), frequency: 4.5 }),
        snap({ entityId: 'e1', entityLevel: 'CAMPAIGN', date: new Date('2026-08-01'), frequency: 5.0 }),
        snap({ entityId: 'e1', entityLevel: 'CAMPAIGN', date: new Date('2026-08-02'), frequency: 5.5 }),
      ]);
      await sweepGuardrails(WS);

      const rows = prisma.decision.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.entityLevel).sort()).toEqual(['ADSET', 'CAMPAIGN']);
    });

    it('performs no latest-per-entity reduction — a collapsed series cannot sustain', async () => {
      // The rule needs 2 consecutive points. If anything reduced the series to
      // its latest row, `series.length < need` would silently produce no hit.
      prisma.metricSnapshot.findMany.mockResolvedValue([
        snap({ date: new Date('2026-08-01') }),
        snap({ date: new Date('2026-08-02') }),
      ]);
      await sweepGuardrails(WS);
      expect(prisma.decision.createMany).toHaveBeenCalled();
      expect(prisma.decision.createMany.mock.calls[0][0].data).toHaveLength(1);
    });

    it('eligibility is decided in the query, not after the series is built', async () => {
      // Filter-before-latest, in the only form this consumer has: the service
      // does no post-hoc window/date filtering of its own, so whatever the
      // Evidence layer returned IS the series. A stray canonical row reaching
      // the loop would become a series point — which is why the filter must
      // live in the query, and why nothing here re-checks it.
      expect(SRC).not.toMatch(/measurementWindow/);
      expect(SRC).not.toMatch(/CUMULATIVE_30D/);
      expect(SRC).not.toMatch(/\.filter\(/);
    });
  });

  // ── 9: decision parity ───────────────────────────────────────────────────
  describe('decision parity', () => {
    it('produces the same PROPOSED Decision, now carrying its evidence reference', async () => {
      // R5 ADDS ONE KEY AND CHANGES NOTHING ELSE. The eight fields below are the
      // pre-R5 row, asserted exhaustively so a semantic change hides nowhere;
      // `evidenceReference` is the ninth, and it describes the series this rule
      // fired on rather than restating its conclusion.
      prisma.metricSnapshot.findMany.mockResolvedValue([
        snap({ date: new Date('2026-08-01'), frequency: 4.0 }),
        snap({ date: new Date('2026-08-02'), frequency: 4.5 }),
      ]);
      const out = await sweepGuardrails(WS);

      expect(prisma.decision.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.decision.createMany.mock.calls[0][0].data).toEqual([{
        workspaceId: WS,
        entityId:    'e1',
        entityLevel: 'ADSET',
        verdict:     'WATCH',
        confidence:  0.9,
        diagnosis:   'Frequency ceiling: frequency > 3 for 2 day(s)',
        rootCause:   'guardrail:Frequency ceiling',
        status:      'PROPOSED',
        evidenceReference: {
          population: 'operational',
          selector:   'selectOperationalSnapshots',
          // NOT ESTABLISHED, not invented: the operational population admits two
          // windows and this reader projects neither the column nor `source`.
          measurementWindow: null,
          sources:    null,
          // BOTH observation timestamps, from the evidence rows themselves —
          // this is the assertion that fails if `observedAt` is ever taken from
          // the decision's own createdAt or from a clock.
          observedAt: ['2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'],
          reduction:  'series',
          entityIds:  ['e1'],
          // TWO, not one. The decision is a single row; the evidence was not.
          rowCount:   2,
          refs:       [],
        },
      }]);
      expect(out).toEqual({ rules: 1, hits: 1, decisionsCreated: 1 });
    });

    it('writes nothing when no rule fires', async () => {
      prisma.metricSnapshot.findMany.mockResolvedValue([
        snap({ date: new Date('2026-08-01'), frequency: 1.0 }),
        snap({ date: new Date('2026-08-02'), frequency: 1.1 }),
      ]);
      const out = await sweepGuardrails(WS);
      expect(prisma.decision.createMany).not.toHaveBeenCalled();
      expect(out).toEqual({ rules: 1, hits: 0, decisionsCreated: 0 });
    });

    it('short-circuits before touching evidence when no rules are enabled', async () => {
      prisma.guardrailRule.findMany.mockResolvedValue([]);
      const out = await sweepGuardrails(WS);
      expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
      expect(out).toEqual({ rules: 0, hits: 0, decisionsCreated: 0 });
    });
  });
});
