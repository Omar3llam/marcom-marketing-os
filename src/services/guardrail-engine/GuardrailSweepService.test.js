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
    // C-02 — the sweep now reads open episodes before writing and closes ended
    // ones, so the mock carries the reader and the transaction as well.
    decision:       { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    $transaction:   vi.fn(async (ops) => Promise.all(ops)),
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
  // C-02 default: no episode is already running, so every hit is a new one and
  // these tests keep asserting exactly what they asserted before.
  prisma.decision.findMany.mockResolvedValue([]);
  prisma.decision.updateMany.mockResolvedValue({ count: 0 });
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
      // NARROWED BY C-02, from a bare /\.filter\(/ over the whole file.
      //
      // The prohibition is about the EVIDENCE SERIES — "whatever the Evidence
      // layer returned IS the series". The blunt form also caught filtering of
      // DECISION rows, which is a different subject: C-02 selects which hits are
      // new by comparing them against the episodes already open, and that has
      // nothing to do with which snapshots reached the loop.
      //
      // These two name the actual rule instead of a token that happened to
      // appear in it, so the guard still fails if anyone re-filters the evidence.
      expect(SRC).not.toMatch(/snapshots\s*\.\s*filter\(/);
      expect(SRC).not.toMatch(/series\s*\.\s*filter\(/);
    });
  });

  // ── 9: decision parity ───────────────────────────────────────────────────
  describe('decision parity', () => {
    it('produces the same PROPOSED Decision, now carrying its evidence reference', async () => {
      // R5 ADDS ONE KEY AND CHANGES NOTHING ELSE. The eight fields below are the
      // pre-R5 row, asserted exhaustively so a semantic change hides nowhere;
      // `evidenceReference` is the ninth, and it describes the series this rule
      // fired on rather than restating its conclusion.
      //
      // C-02 ADDS TWO MORE, and deliberately does not touch the nine. The
      // identity is written ALONGSIDE `rootCause`, not instead of it: every
      // current consumer still matches the `guardrail:` prefix, so replacing the
      // display string here would have been a second change smuggled in behind
      // a dedupe. `guardrailRuleId` is the stable id the engine always returned
      // and this writer used to discard; `openHitKey` is that id joined to the
      // entity, and it is NULLed when the episode closes.
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
        // C-10 — declared as a token. `rootCause` above keeps the display
        // string; this is what any reader may scope by, and what stopped three
        // separate modules parsing that prefix.
        decisionClass: 'GUARDRAIL',
        guardrailRuleId: 'rule-1',
        openHitKey:      'rule-1:e1:ADSET',
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
      expect(out).toEqual({ rules: 1, hits: 1, decisionsCreated: 1, episodesClosed: 0 });
    });

    it('writes nothing when no rule fires', async () => {
      prisma.metricSnapshot.findMany.mockResolvedValue([
        snap({ date: new Date('2026-08-01'), frequency: 1.0 }),
        snap({ date: new Date('2026-08-02'), frequency: 1.1 }),
      ]);
      const out = await sweepGuardrails(WS);
      expect(prisma.decision.createMany).not.toHaveBeenCalled();
      expect(out).toEqual({ rules: 1, hits: 0, decisionsCreated: 0, episodesClosed: 0 });
    });

    it('short-circuits before touching evidence when no rules are enabled', async () => {
      prisma.guardrailRule.findMany.mockResolvedValue([]);
      const out = await sweepGuardrails(WS);
      expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
      expect(out).toEqual({ rules: 0, hits: 0, decisionsCreated: 0, episodesClosed: 0 });
    });
  });
});

// ============================================================
// C-02 — a hit is a breach EPISODE
// ============================================================
// Before this, `createMany` ran with no existence check: a standing breach on a
// 15-minute cron minted roughly 96 indistinguishable rows a day. The fix is not
// a dedupe query — it is that the sweep now knows what makes two breaches the
// same breach, and equally what it did NOT look at.
//
// The tests that matter most here are the ones asserting nothing closes.
// Treating "we did not evaluate this pair" as an all-clear would let disabling a
// rule silently clear every breach it was holding open, and an ingest gap read
// as the problem going away.
describe('C-02 — guardrail hit identity', () => {
  const breaching = () => [
    snap({ date: new Date('2026-08-01'), frequency: 4.0 }),
    snap({ date: new Date('2026-08-02'), frequency: 4.5 }),
  ];
  const calm = () => [
    snap({ date: new Date('2026-08-01'), frequency: 1.0 }),
    snap({ date: new Date('2026-08-02'), frequency: 1.1 }),
  ];
  const openEpisode = { id: 'dec-open', openHitKey: 'rule-1:e1:ADSET' };
  const created = () => (prisma.decision.createMany.mock.calls[0]?.[0]?.data ?? []);
  const closed  = () => (prisma.decision.updateMany.mock.calls[0]?.[0] ?? null);

  it('a second sweep over an unchanged breach writes nothing', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(breaching());
    prisma.decision.findMany.mockResolvedValue([openEpisode]);

    const out = await sweepGuardrails(WS);

    // The rule still fires — the breach is real and ongoing. What changed is
    // that its episode was already open, so no second row is minted.
    expect(out.hits).toBe(1);
    expect(out.decisionsCreated).toBe(0);
    expect(prisma.decision.createMany).not.toHaveBeenCalled();
    expect(out.episodesClosed).toBe(0);
  });

  it('only the pairs it judged are looked up, scoped to this workspace', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(breaching());
    await sweepGuardrails(WS);

    expect(prisma.decision.findMany).toHaveBeenCalledWith({
      // C-10 — the class is declared alongside the key. `openHitKey` already
      // implied GUARDRAIL, but implication is what the eleven blind reads were
      // made of: a reader that means one class says so.
      where:  { workspaceId: WS, decisionClass: { in: ['GUARDRAIL'] }, openHitKey: { in: ['rule-1:e1:ADSET'] } },
      select: { id: true, openHitKey: true },
    });
  });

  it('a pair judged CLEAR closes its open episode and releases the key', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(calm());
    prisma.decision.findMany.mockResolvedValue([openEpisode]);

    const out = await sweepGuardrails(WS);

    expect(out.episodesClosed).toBe(1);
    expect(closed().where).toEqual({ id: { in: ['dec-open'] } });
    expect(closed().data.status).toBe('RESOLVED');
    // Releasing the key is what lets the same breach return as a NEW episode:
    // PostgreSQL exempts NULL from the unique index.
    expect(closed().data.openHitKey).toBeNull();
    // Closure says the episode ended. It makes no claim about the outcome, and
    // this assertion is the guard on that: `resolution` is the column
    // `decisionLearning` admits rows on (resolution IS NOT NULL +
    // INTERVENED_WHERE), so writing one here would quietly enrol executed
    // Guardrail decisions into institutional memory. That population has an
    // owner and it is not this sweep.
    expect(closed().data).not.toHaveProperty('resolution');
    expect(closed().data.resolvedAt).toBeInstanceOf(Date);
  });

  it('a breach returning after closure opens a NEW row, never revives the old one', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue(breaching());
    // The previous episode closed, so its key was released and nothing is open.
    prisma.decision.findMany.mockResolvedValue([]);

    const out = await sweepGuardrails(WS);

    expect(out.decisionsCreated).toBe(1);
    expect(created()[0].openHitKey).toBe('rule-1:e1:ADSET');
    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
  });

  it('DISABLING a rule closes nothing — the sweep never judged the pair', async () => {
    // sweepGuardrails loads only enabled rules, so a disabled rule produces no
    // evaluated pairs at all. The open episode must survive: switching a rule
    // off is not evidence that the breach behind it ended.
    prisma.guardrailRule.findMany.mockResolvedValue([]);
    prisma.decision.findMany.mockResolvedValue([openEpisode]);

    const out = await sweepGuardrails(WS);

    expect(out).toEqual({ rules: 0, hits: 0, decisionsCreated: 0, episodesClosed: 0 });
    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
  });

  it('an entity that fell out of the sync window closes nothing', async () => {
    // No snapshots means no entity window, so the pair is never judged. Closing
    // here would end an episode because we stopped receiving evidence about it.
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    prisma.decision.findMany.mockResolvedValue([openEpisode]);

    const out = await sweepGuardrails(WS);

    expect(out.episodesClosed).toBe(0);
    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
    // And it did not even ask: with nothing judged there is no key to look up.
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
  });

  it('too little history to sustain closes nothing', async () => {
    // One day against sustainedDays: 2 — in scope, but not enough to say either
    // way. Insufficient data is not an all-clear.
    prisma.metricSnapshot.findMany.mockResolvedValue([snap({ date: new Date('2026-08-02'), frequency: 1.0 })]);
    prisma.decision.findMany.mockResolvedValue([openEpisode]);

    const out = await sweepGuardrails(WS);

    expect(out.episodesClosed).toBe(0);
    expect(prisma.decision.findMany).not.toHaveBeenCalled();
  });

  it('two rules over one entity are two independent episodes', async () => {
    const second = { ...RULE, id: 'rule-2', name: 'Frequency floor', comparator: 'LT', threshold: 0.5 };
    prisma.guardrailRule.findMany.mockResolvedValue([RULE, second]);
    prisma.metricSnapshot.findMany.mockResolvedValue(breaching());
    // rule-1 breaches and is already open; rule-2 declines and is open too.
    prisma.decision.findMany.mockResolvedValue([
      openEpisode,
      { id: 'dec-open-2', openHitKey: 'rule-2:e1:ADSET' },
    ]);

    const out = await sweepGuardrails(WS);

    // One entity, one sweep: one episode held open and a different one closed.
    expect(out.decisionsCreated).toBe(0);
    expect(out.episodesClosed).toBe(1);
    expect(closed().where).toEqual({ id: { in: ['dec-open-2'] } });
  });

  it('opens and closes in a single transaction', async () => {
    const second = { ...RULE, id: 'rule-2', name: 'Frequency floor', comparator: 'LT', threshold: 0.5 };
    prisma.guardrailRule.findMany.mockResolvedValue([RULE, second]);
    prisma.metricSnapshot.findMany.mockResolvedValue(breaching());
    prisma.decision.findMany.mockResolvedValue([{ id: 'dec-open-2', openHitKey: 'rule-2:e1:ADSET' }]);

    await sweepGuardrails(WS);

    // A partial application would leave an episode both closed and re-opened, or
    // neither — the pair is one statement about what this sweep concluded.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('the insert carries skipDuplicates — the index is the backstop, not the plan', async () => {
    // Two sweeps racing on one workspace can both read "no episode open". The
    // filter is the intent; the unique index is what makes the loser a no-op
    // rather than a failed sweep.
    prisma.metricSnapshot.findMany.mockResolvedValue(breaching());
    await sweepGuardrails(WS);
    expect(prisma.decision.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
});
