// ============================================================
// R5 — the evidence reference a persisted verdict carries (I18)
// ============================================================
// The write side of provenance. A sibling of VerdictService.lifecycle.test.js,
// which owns the metric stamping and the supersede path; this one owns the one
// question a stored Decision could never answer before:
//
//   what evidence population produced me, over which measurement window, from
//   which source(s) and observation time(s), and how were several rows reduced
//   into the conclusion?
//
// OBSERVED AT THE WRITE, not at the projector. evidenceReference.test.js already
// holds the pure contract; what this file protects is that the basis and the
// rows actually SURVIVE the verdict path — through metricsOf, which used to drop
// `source`, and through buildConnectorVerdictTree, which used to drop the
// observation date — and land on the row. Asserting the projector twice would
// prove the shape twice and the carriage never.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() } },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { persistLevelVerdicts } from './VerdictService.js';

const WS = 'ws-1';
const ID = 'c1c1c1c1-0000-4000-8000-000000000001';

const OBSERVED = new Date('2026-08-10T09:00:00Z');

// The basis a canonical read declares, written out BY HAND rather than imported
// from CANONICAL_VERDICT_EVIDENCE_BASIS. Importing it would let the fixture and
// the implementation agree with each other about what canonical evidence is,
// which is the agreement a provenance test has to withhold.
const CANONICAL_BASIS = Object.freeze({
  population:        'canonical-verdict',
  selector:          'selectCanonicalVerdictSnapshots',
  measurementWindow: 'CUMULATIVE_30D',
  reduction:         'latest-per-entity',
  rowCount:          11,
});

const EVIDENCE_ROWS = Object.freeze([
  Object.freeze({ entityId: ID, source: 'META', observedAt: OBSERVED }),
]);

const tree = (node = {}) => ({
  id: null, level: null, name: 'acct',
  children: [{
    id: ID, level: 'CAMPAIGN', name: 'Eid', children: [],
    metrics: {
      spendMinor: 100_000, impressions: 10_000, clicks: 164,
      conversions: 0, revenueMinor: 0, frequency: 2.1,
    },
    evidenceBasis: { ...CANONICAL_BASIS },
    evidenceRows:  EVIDENCE_ROWS.map((r) => ({ ...r })),
    ...node,
  }],
});

const created = () => prisma.decision.create.mock.calls[0][0].data;
const ref = () => created().evidenceReference;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findFirst.mockResolvedValue(null);
  prisma.decision.create.mockResolvedValue({ id: 'new-1' });
  prisma.decision.update.mockResolvedValue({});
});

describe('R5 — a persisted verdict names its evidence', () => {
  it('writes a reference that answers the whole question', async () => {
    // The acceptance criterion, in one assertion: population, window, sources,
    // observation times, reduction and how many rows were consumed — all from
    // the stored row, none of it requiring a second look at the database.
    await persistLevelVerdicts(WS, tree());
    expect(ref()).toEqual({
      population:        'canonical-verdict',
      selector:          'selectCanonicalVerdictSnapshots',
      measurementWindow: 'CUMULATIVE_30D',
      sources:           ['META'],
      observedAt:        ['2026-08-10T09:00:00.000Z'],
      reduction:         'latest-per-entity',
      entityIds:         [ID],
      rowCount:          11,
      refs:              [],
    });
  });

  it('does not disturb what the row already recorded', async () => {
    // R5 is additive. The verdict, the confidence, the stamped metrics and the
    // reasoning columns are the row as it was; provenance sits beside them.
    await persistLevelVerdicts(WS, tree());
    const row = created();
    expect(row.verdict).toBe('HOLD');
    expect(row.entityId).toBe(ID);
    expect(row.ctrAtDecision).toBeCloseTo(1.64, 6);
    expect(row.roasAtDecision).toBeNull();
    expect(row.status).toBe('PROPOSED');
  });

  // ── the temporal rule ───────────────────────────────────────────────────
  describe('observedAt is the EVIDENCE row\'s time', () => {
    it('is the snapshot\'s observation timestamp, not the decision\'s own clock', async () => {
      // THE MUTATION THIS EXISTS TO CATCH. `Decision.createdAt` is set by the
      // database at write time and is always ~now; the evidence was observed in
      // the past. A reference that reported the former would date every
      // historical decision to whenever it happened to be written.
      const before = Date.now();
      await persistLevelVerdicts(WS, tree());
      expect(ref().observedAt).toEqual(['2026-08-10T09:00:00.000Z']);

      const stamped = new Date(ref().observedAt[0]).getTime();
      expect(stamped).toBeLessThan(before);
      // …and the writer set no createdAt of its own to be confused with it.
      expect(created().createdAt).toBeUndefined();
    });

    it('carries a SECOND observation when two rows contributed', async () => {
      // The blended case in miniature: a platform row and an actual-revenue row
      // with different sources and different dates. One timestamp and one source
      // would name the platform's date beside the actual's revenue.
      await persistLevelVerdicts(WS, tree({
        evidenceRows: [
          { entityId: ID, source: 'META', observedAt: OBSERVED },
          { entityId: ID, source: 'GA4',  observedAt: new Date('2026-08-11T09:00:00Z') },
        ],
      }));
      expect(ref().sources).toEqual(['META', 'GA4']);
      expect(ref().observedAt).toEqual([
        '2026-08-10T09:00:00.000Z', '2026-08-11T09:00:00.000Z',
      ]);
    });
  });

  // ── multi-row ───────────────────────────────────────────────────────────
  describe('multi-row evidence', () => {
    it('records the rows CONSUMED, not the one decision produced', async () => {
      await persistLevelVerdicts(WS, tree());
      expect(ref().rowCount).toBe(11);
      expect(ref().rowCount).not.toBe(1);
    });

    it('reports zero honestly rather than rounding a read up to one', async () => {
      await persistLevelVerdicts(WS, tree({
        evidenceBasis: { ...CANONICAL_BASIS, rowCount: 0 },
        evidenceRows:  [],
      }));
      expect(ref().rowCount).toBe(0);
      expect(ref().sources).toEqual([]);
    });
  });

  // ── null is a real state ────────────────────────────────────────────────
  describe('null means not captured, and stays null', () => {
    it('writes null when the node declared no basis', async () => {
      // An internal/rollup node, or any caller that never declared one. There is
      // no population, window or observation time to name, and a reference
      // invented for it would assert a read that never happened.
      await persistLevelVerdicts(WS, tree({ evidenceBasis: undefined, evidenceRows: undefined }));
      expect(ref()).toBeNull();
      expect(ref()).not.toEqual([]);
      expect(ref()).not.toEqual({});
    });

    it('still writes the decision when provenance cannot be described', async () => {
      // Best-effort, like resolvePrevious. A KILL must not be lost because its
      // provenance could not be built — the row lands, the reference is null
      // ("not captured", which is true), and the failure is logged rather than
      // swallowed silently.
      await persistLevelVerdicts(WS, tree({
        evidenceBasis: { ...CANONICAL_BASIS, population: 'invented-population' },
      }));
      expect(prisma.decision.create).toHaveBeenCalledTimes(1);
      expect(created().verdict).toBe('HOLD');
      expect(ref()).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ── canonical vs operational ────────────────────────────────────────────
  it('a canonical decision and an operational one stay distinguishable', async () => {
    // I4, at the persistence layer this time. Upstream the two populations are
    // kept apart by separate selectors; downstream they used to be two rows in
    // one table with nothing to tell them apart but a rootCause string prefix.
    await persistLevelVerdicts(WS, tree());
    const canonical = ref();

    vi.clearAllMocks();
    prisma.decision.findFirst.mockResolvedValue(null);
    prisma.decision.create.mockResolvedValue({ id: 'new-2' });
    await persistLevelVerdicts(WS, tree({
      evidenceBasis: {
        population: 'operational', selector: 'selectOperationalSnapshots',
        reduction: 'series', rowCount: 4,
      },
    }));
    const operational = ref();

    expect(canonical.population).toBe('canonical-verdict');
    expect(operational.population).toBe('operational');
    expect(canonical.measurementWindow).toBe('CUMULATIVE_30D');
    // Honestly unestablished, NOT borrowed from the canonical read beside it.
    expect(operational.measurementWindow).toBeNull();
  });

  // ── historical integrity ────────────────────────────────────────────────
  describe('the reference belongs to the moment it was written', () => {
    it('is unaffected by the evidence row changing afterwards', async () => {
      // Snapshots are UPSERTED on every sync, which is the whole reason a bare
      // row id would not have done. The reference is built from the values the
      // decision actually saw, so mutating the row it came from cannot reach it.
      const rows = [{ entityId: ID, source: 'META', observedAt: OBSERVED }];
      await persistLevelVerdicts(WS, tree({ evidenceRows: rows }));
      const frozen = JSON.parse(JSON.stringify(ref()));

      rows[0].source = 'GOOGLE';
      rows[0].observedAt = new Date('2027-01-01T00:00:00Z');

      expect(ref()).toEqual(frozen);
      expect(ref().sources).toEqual(['META']);
    });

    it('is written only on create — the supersede path never touches it', async () => {
      // resolvePrevious closes a row out with outcome fields. Rewriting the
      // provenance there would make a superseded decision claim it was looking
      // at evidence that arrived after it was made.
      prisma.decision.findFirst.mockResolvedValue({
        id: 'old-1', verdict: 'KILL', ctrAtDecision: 1.0, roasAtDecision: null,
      });
      await persistLevelVerdicts(WS, tree());

      expect(prisma.decision.update).toHaveBeenCalledTimes(1);
      const patch = prisma.decision.update.mock.calls[0][0].data;
      expect(patch).not.toHaveProperty('evidenceReference');
      expect(Object.keys(patch).sort())
        .toEqual(['confidenceDelta', 'resolution', 'resolvedAt', 'status']);
    });
  });

  // ── it must not have changed what Lumi decides ──────────────────────────
  it('provenance reaches the row without moving the verdict', async () => {
    // The acceptance criterion's second half. Same tree, once with a basis and
    // once without: the verdict, confidence and stamped metrics are identical,
    // and only the provenance differs.
    await persistLevelVerdicts(WS, tree());
    const withRef = created();

    vi.clearAllMocks();
    prisma.decision.findFirst.mockResolvedValue(null);
    prisma.decision.create.mockResolvedValue({ id: 'new-3' });
    await persistLevelVerdicts(WS, tree({ evidenceBasis: undefined, evidenceRows: undefined }));
    const withoutRef = created();

    const { evidenceReference: a, ...restWith } = withRef;
    const { evidenceReference: b, ...restWithout } = withoutRef;
    expect(restWith).toEqual(restWithout);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });
});
