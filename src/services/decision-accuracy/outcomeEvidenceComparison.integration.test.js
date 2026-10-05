// ============================================================
// B5-01X' — observed evidence, against a real database
// ============================================================
// Every number this suite asserts is traced back to rows it seeded itself. There
// is no fixture aggregate and no mocked reader: the point of the slice is that
// an operator is shown Lumi's actual observations, and a mocked projection
// cannot prove that (B5-01V is the standing lesson — a mock never applies the
// `select`, so it can agree with a query that could not run).
//
// The load-bearing assertions are the ones about what does NOT happen: T11 and
// T13. Observation must not become an outcome, and the daily population must not
// leak into operational truth.
//
// Skips when no migrated database is reachable (src/tests/dbProbe.js).
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dbAvailable } from '../../tests/dbProbe.js';
import { prisma } from '../../lib/prisma.js';
import {
  readOutcomeEvidence, EVIDENCE_STATUS, UNSUPPORTED_REASON, EVIDENCE_ERROR,
  SUMMED_METRICS, ADDITIVE_METRICS,
} from './outcomeEvidenceComparison.js';
import { COMPARISON_WINDOW_DAYS, comparisonWindows } from './comparisonWindow.js';
import { DEFAULT_CONFIG } from './accuracyTypes.js';
import { recordOutcome, listPendingOutcomes } from './DecisionAccuracyService.js';
import { selectOperationalSnapshots } from '../evidence/index.js';
import { getBriefing } from '../pattern-engine/PatternService.js';

const DB_OK = await dbAvailable();
const DAY = 86_400_000;

// A fixed, comfortably-past intervention. Mid-day on purpose: the policy must be
// a function of the DATE, and a 09:30 boundary also makes the intervention day
// straddle, which is the reader's CROSSES_BOUNDARY path.
const BOUNDARY = new Date('2026-08-10T09:30:00.000Z');
const W = comparisonWindows(BOUNDARY);

describe.skipIf(!DB_OK)("B5-01X' · outcome evidence comparison", () => {
  const ws = randomUUID();
  const accountId = randomUUID();

  const mkCampaign = async (channel = 'META') => {
    const id = randomUUID();
    await prisma.campaign.create({
      data: {
        id, workspaceId: ws, accountId, channel, name: `c-${id.slice(0, 8)}`,
        externalId: `ext-${id.slice(0, 8)}`,
      },
    });
    return id;
  };

  const mkDecision = (entityId, over = {}) => prisma.decision.create({
    data: {
      workspaceId: ws, entityId, entityLevel: 'CAMPAIGN', verdict: 'KILL',
      confidence: 0.72, diagnosis: 'bleeding at frequency 3.6', rootCause: 'creative_fatigue',
      createdAt: new Date(BOUNDARY.getTime() - DAY),
      humanExecutedAt: BOUNDARY,
      decisionClass: 'SIGNAL', // C-10 — what VerdictService writes
      ...over,
    },
  });

  /** One DAILY row for one declared day, exactly as Phase E lands them. */
  const mkDaily = (entityId, day, { spendMinor, revenueMinor, source = 'META', observedAt, entityLevel = 'CAMPAIGN',
    currency = 'USD', currencyProvenance = 'PLATFORM_REPORTED' } = {}) => {
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    return prisma.metricSnapshot.create({
      data: {
        workspaceId: ws, entityId, entityLevel, source,
        measurementWindow: 'DAILY', granularity: 'DAILY',
        // The SYNC instant, deliberately later than the day it measures.
        date: observedAt ?? new Date(dayStart.getTime() + 2 * DAY),
        windowStart: dayStart, windowEnd: dayStart,
        spendMinor, revenueMinor,
        impressions: 20_000, clicks: 400, conversions: 5, ctr: 0.02,
        // The per-row ratio, which T3 proves is never what a window total uses.
        roas: spendMinor > 0 ? revenueMinor / spendMinor : null,
        currency, currencyProvenance,
      },
    });
  };

  const seedWindow = (entityId, days, valuesFor) => Promise.all(
    days.map((day) => mkDaily(entityId, day, valuesFor(day))),
  );

  beforeAll(async () => {
    await prisma.workspace.create({ data: { id: ws, name: `b5-01x-${ws.slice(0, 8)}` } });
    await prisma.account.create({
      data: {
        id: accountId, workspaceId: ws, channel: 'META',
        name: 'B5X acct', externalId: `act-${accountId.slice(0, 8)}`,
      },
    });
  });

  afterAll(async () => {
    await prisma.outcomeSnapshot.deleteMany({ where: { workspaceId: ws } });
    await prisma.patternObservation.deleteMany({ where: { pattern: { workspaceId: ws } } });
    await prisma.accountPattern.deleteMany({ where: { workspaceId: ws } });
    await prisma.decision.deleteMany({ where: { workspaceId: ws } });
    await prisma.metricSnapshot.deleteMany({ where: { workspaceId: ws } });
    await prisma.campaign.deleteMany({ where: { workspaceId: ws } });
    await prisma.account.deleteMany({ where: { workspaceId: ws } });
    await prisma.workspace.deleteMany({ where: { id: ws } });
  });

  // ── the policy itself ────────────────────────────────────────
  describe('the comparison window policy', () => {
    it('excludes the intervention day from both windows', () => {
      expect(W.interventionDay).toBe('2026-08-10');
      expect(W.baseline.days).toEqual([
        '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
        '2026-08-07', '2026-08-08', '2026-08-09',
      ]);
      expect(W.observation.days).toEqual([
        '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
        '2026-08-15', '2026-08-16', '2026-08-17',
      ]);
      expect(W.baseline.days).not.toContain('2026-08-10');
      expect(W.observation.days).not.toContain('2026-08-10');
    });

    it('is a function of the DATE, not the time of day', () => {
      const early = comparisonWindows(new Date('2026-08-10T00:00:01.000Z'));
      const late = comparisonWindows(new Date('2026-08-10T23:59:59.000Z'));
      expect(early.baseline.days).toEqual(late.baseline.days);
      expect(early.observation.days).toEqual(late.observation.days);
    });

    it('owns its own constant — maturity age is a different question', async () => {
      // COMMENTS STRIPPED FIRST. The module's header explains precisely why it
      // is not maturationDays, so a scanner that could not tell prose from a
      // reference would force the file to stop documenting the distinction it
      // exists to hold — operationalIsolation's rule, for the same reason.
      const src = readFileSync(fileURLToPath(new URL('./comparisonWindow.js', import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      // Same number today, and it must not be REACHED THROUGH the maturity config:
      // the two move independently the first time either is tuned.
      expect(COMPARISON_WINDOW_DAYS).toBe(7);
      expect(DEFAULT_CONFIG.maturationDays).toBe(7);
      expect(src).not.toMatch(/maturationDays|accuracyTypes/);
    });

    it('only sums metrics the repository calls additive', () => {
      for (const m of SUMMED_METRICS) expect(ADDITIVE_METRICS).toContain(m);
      expect(SUMMED_METRICS).not.toContain('roas');
      expect(SUMMED_METRICS).not.toContain('ctr');
    });
  });

  // ── T1 ───────────────────────────────────────────────────────
  describe('P7-07C persisted monetary lineage and refusal', () => {
    it.each(['EGP', 'USD'])('preserves persisted %s authority through the actual daily reader', async currency => {
      const entityId = await mkCampaign();
      const decision = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 100, revenueMinor: 200, currency }));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 50, revenueMinor: 0, currency }));
      const result = await readOutcomeEvidence(ws, decision.id);
      expect(result).toMatchObject({ status: 'MEASURABLE', baseline: { spendMinor: 700, revenueMinor: 1400, currency, currencyProvenance: 'PLATFORM_REPORTED' },
        observation: { spendMinor: 350, revenueMinor: 0, roas: 0, currency, currencyProvenance: 'PLATFORM_REPORTED' },
        delta: { spendMinor: -350, revenueMinor: -1400, roas: -2, currency, currencyProvenance: 'PLATFORM_REPORTED' } });
    });
    // Persisted currency is NOT NULL. Unsupported codes/legacy origin cover
    // stored uncertainty; null contributors are exercised by pure/read seams.
    it.each([{ currency: 'EUR' }, { currency: 'ZZZ' }, { currencyProvenance: 'LEGACY_UNKNOWN' }, { currencyProvenance: 'WORKSPACE_INFERRED' }])(
      'refuses complete unsafe persisted evidence %j without discarding coverage', async unsafe => {
        const entityId = await mkCampaign();
        const decision = await mkDecision(entityId);
        await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 100, revenueMinor: 200 }));
        await seedWindow(entityId, W.observation.days, day => ({ spendMinor: 50, revenueMinor: 100, ...(day === W.observation.days[0] ? unsafe : {}) }));
        const result = await readOutcomeEvidence(ws, decision.id);
        expect(result).toMatchObject({ status: 'NOT_MEASURABLE', reason: 'MONETARY_BASIS_UNAVAILABLE',
          observation: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null },
          delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } });
        expect(result.observation.coverage).toMatchObject({ observed: 7, complete: true });
        expect(result.observation.refs).toHaveLength(7);
      });
    it('complete independent USD/EUR windows retain their own amounts, but no delta', async () => {
      const entityId = await mkCampaign();
      const decision = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 100, revenueMinor: 200 }));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 50, revenueMinor: 100, currency: 'EUR' }));
      expect(await readOutcomeEvidence(ws, decision.id)).toMatchObject({ status: 'NOT_MEASURABLE', reason: 'MONETARY_BASIS_UNAVAILABLE',
        baseline: { spendMinor: 700, currency: 'USD' }, observation: { spendMinor: 350, currency: 'EUR' },
        delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } });
    });
  });

  describe('T1 · a full, measurable comparison', () => {
    let entityId; let decision;
    beforeAll(async () => {
      entityId = await mkCampaign();
      decision = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 10_000, revenueMinor: 12_000 }));
    });

    it('reports MEASURABLE with complete coverage on both sides', async () => {
      const r = await readOutcomeEvidence(ws, decision.id);
      expect(r.status).toBe(EVIDENCE_STATUS.MEASURABLE);
      expect(r.source).toBe('META');
      expect(r.baseline.coverage).toMatchObject({ required: 7, observed: 7, missing: [], complete: true });
      expect(r.observation.coverage).toMatchObject({ required: 7, observed: 7, missing: [], complete: true });
    });

    it('every total is the sum of the rows it seeded', async () => {
      const r = await readOutcomeEvidence(ws, decision.id);
      expect(r.baseline.spendMinor).toBe(7 * 50_000);
      expect(r.baseline.revenueMinor).toBe(7 * 25_000);
      expect(r.observation.spendMinor).toBe(7 * 10_000);
      expect(r.observation.revenueMinor).toBe(7 * 12_000);
      expect(r.delta.spendMinor).toBe(7 * 10_000 - 7 * 50_000);
      expect(r.delta.revenueMinor).toBe(7 * 12_000 - 7 * 25_000);
    });

    it('states each window ROAS as the ratio of its own totals', async () => {
      const r = await readOutcomeEvidence(ws, decision.id);
      expect(r.baseline.roas).toBeCloseTo((7 * 25_000) / (7 * 50_000), 10);
      expect(r.observation.roas).toBeCloseTo((7 * 12_000) / (7 * 10_000), 10);
      expect(r.delta.roas).toBeCloseTo(r.observation.roas - r.baseline.roas, 10);
    });

    it('names the exact rows it consumed', async () => {
      const r = await readOutcomeEvidence(ws, decision.id);
      const ids = [...r.baseline.refs, ...r.observation.refs].map((x) => x.id);
      expect(ids).toHaveLength(14);
      const rows = await prisma.metricSnapshot.findMany({ where: { id: { in: ids } }, select: { id: true } });
      expect(rows).toHaveLength(14);
    });
  });

  // ── T2 ───────────────────────────────────────────────────────
  // The guard against silently reusing the reader's latestBefore/earliestAfter
  // pair as the product comparison. The fixture is built so the two answers
  // cannot coincide.
  describe('T2 · the comparison is the WINDOW, not the adjacent day pair', () => {
    let decision;
    beforeAll(async () => {
      const entityId = await mkCampaign();
      decision = await mkDecision(entityId);
      // Baseline: a flat 10_000/day → 70_000 over the window.
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 10_000, revenueMinor: 5_000 }));
      // Observation: the whole week's spend lands on its FIRST day, then zero.
      // Window total is also 70_000 → a true window delta of 0.
      // The adjacent pair (2026-08-09 vs 2026-08-11) would read 70_000 − 10_000
      // = +60_000, which is the wrong answer this test exists to catch.
      await seedWindow(entityId, W.observation.days, (day) => (day === W.observation.days[0]
        ? { spendMinor: 70_000, revenueMinor: 35_000 }
        : { spendMinor: 0, revenueMinor: 0 }));
    });

    it('sums the full window rather than differencing two days', async () => {
      const r = await readOutcomeEvidence(ws, decision.id);
      expect(r.status).toBe(EVIDENCE_STATUS.MEASURABLE);
      expect(r.baseline.spendMinor).toBe(70_000);
      expect(r.observation.spendMinor).toBe(70_000);
      expect(r.delta.spendMinor).toBe(0);
      // The adjacent-pair answer, explicitly refused.
      expect(r.delta.spendMinor).not.toBe(60_000);
    });
  });

  // ── T3 ───────────────────────────────────────────────────────
  describe('T3 · ROAS is the ratio of window totals, never a mean of daily ratios', () => {
    let decision; let rowValues;
    beforeAll(async () => {
      const entityId = await mkCampaign();
      decision = await mkDecision(entityId);
      // One tiny, wildly profitable day and six large break-even ones. The mean
      // of the daily ratios and the ratio of the totals are far apart.
      rowValues = W.baseline.days.map((day, i) => (i === 0
        ? { spendMinor: 100, revenueMinor: 4_000 }
        : { spendMinor: 100_000, revenueMinor: 100_000 }));
      await Promise.all(W.baseline.days.map((day, i) => mkDaily(entityId, day, rowValues[i])));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 10_000, revenueMinor: 10_000 }));
    });

    it('uses Σrevenue / Σspend', async () => {
      const r = await readOutcomeEvidence(ws, decision.id);
      const totalSpend = rowValues.reduce((s, v) => s + v.spendMinor, 0);
      const totalRevenue = rowValues.reduce((s, v) => s + v.revenueMinor, 0);
      const ratioOfTotals = totalRevenue / totalSpend;
      const meanOfRatios = rowValues.reduce((s, v) => s + v.revenueMinor / v.spendMinor, 0) / rowValues.length;

      // The fixture is only meaningful if the two genuinely differ.
      expect(Math.abs(ratioOfTotals - meanOfRatios)).toBeGreaterThan(1);
      expect(r.baseline.roas).toBeCloseTo(ratioOfTotals, 10);
      expect(r.baseline.roas).not.toBeCloseTo(meanOfRatios, 3);
    });

    it('is null rather than infinite when a window had no spend', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 0, revenueMinor: 0 }));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 10_000, revenueMinor: 5_000 }));
      const r = await readOutcomeEvidence(ws, d.id);
      expect(r.baseline.spendMinor).toBe(0);   // a measured zero, from 7 real rows
      expect(r.baseline.roas).toBeNull();      // …but no ratio exists
      expect(r.delta.roas).toBeNull();
    });
  });

  // ── T4 / T5 ──────────────────────────────────────────────────
  describe('T4 · complete baseline, incomplete observation', () => {
    it('is INSUFFICIENT_COVERAGE with no derived delta and the dates named', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));
      const partial = W.observation.days.slice(0, 4);
      await seedWindow(entityId, partial, () => ({ spendMinor: 10_000, revenueMinor: 12_000 }));

      const r = await readOutcomeEvidence(ws, d.id);
      expect(r.status).toBe(EVIDENCE_STATUS.INSUFFICIENT_COVERAGE);
      expect(r.baseline.coverage).toMatchObject({ observed: 7, complete: true });
      expect(r.observation.coverage.observed).toBe(4);
      expect(r.observation.coverage.missing).toEqual(W.observation.days.slice(4));
      expect(r.delta).toEqual({ spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null });
      // The real partial sums survive — they are rows the operator may want —
      // but nothing derived from them is offered.
      expect(r.observation.spendMinor).toBe(4 * 10_000);
    });
  });

  describe('T5 · incomplete baseline, complete observation', () => {
    it('is INSUFFICIENT_COVERAGE in the other direction too', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days.slice(2), () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 10_000, revenueMinor: 12_000 }));

      const r = await readOutcomeEvidence(ws, d.id);
      expect(r.status).toBe(EVIDENCE_STATUS.INSUFFICIENT_COVERAGE);
      expect(r.baseline.coverage.observed).toBe(5);
      expect(r.baseline.coverage.missing).toEqual(W.baseline.days.slice(0, 2));
      expect(r.observation.coverage.complete).toBe(true);
      expect(r.delta).toEqual({ spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null });
    });
  });

  // ── T6 ───────────────────────────────────────────────────────
  describe('T6 · a supported entity Lumi observed nothing for', () => {
    it('is NOT_OBSERVED — never a zero comparison', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId);
      const r = await readOutcomeEvidence(ws, d.id);

      expect(r.status).toBe(EVIDENCE_STATUS.NOT_OBSERVED);
      expect(r.source).toBe('META');
      expect(r.delta).toEqual({ spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null });
      expect(r.baseline.spendMinor).toBeNull();
      expect(r.observation.spendMinor).toBeNull();
      expect(r.baseline.coverage.missing).toEqual(W.baseline.days);
      expect(r.observation.coverage.missing).toEqual(W.observation.days);
    });
  });

  // ── T7 / T8 ──────────────────────────────────────────────────
  describe('T7 · an entity level with no daily population', () => {
    it('is UNSUPPORTED, not NOT_OBSERVED', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId, { entityLevel: 'ADSET' });
      // Rows exist at CAMPAIGN level for this id; the ADSET decision still has
      // no population of its own and must not borrow them.
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));

      const r = await readOutcomeEvidence(ws, d.id);
      expect(r.status).toBe(EVIDENCE_STATUS.UNSUPPORTED);
      expect(r.reason).toBe(UNSUPPORTED_REASON.LEVEL_NOT_INGESTED);
      expect(r.delta).toEqual({ spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null });
      expect(r.baseline).toBeNull();
    });
  });

  describe('T8 · a platform with no daily provider', () => {
    it('is UNSUPPORTED, not NOT_OBSERVED', async () => {
      const entityId = await mkCampaign('GOOGLE');
      const d = await mkDecision(entityId);
      const r = await readOutcomeEvidence(ws, d.id);

      expect(r.status).toBe(EVIDENCE_STATUS.UNSUPPORTED);
      expect(r.reason).toBe(UNSUPPORTED_REASON.CHANNEL_HAS_NO_DAILY_CAPABILITY);
      expect(r.baseline).toBeNull();
    });

    it('an entity that is not in the graph cannot be given a source', async () => {
      const d = await mkDecision(randomUUID());
      const r = await readOutcomeEvidence(ws, d.id);
      expect(r.status).toBe(EVIDENCE_STATUS.UNSUPPORTED);
      expect(r.reason).toBe(UNSUPPORTED_REASON.ENTITY_NOT_IN_GRAPH);
    });
  });

  // ── T9 ───────────────────────────────────────────────────────
  describe('T9 · a failed evidence read', () => {
    it('is UNAVAILABLE with every number null — never empty evidence', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));

      const real = prisma.metricSnapshot.findMany;
      prisma.metricSnapshot.findMany = async () => { throw new Error('connection terminated'); };
      let r;
      try { r = await readOutcomeEvidence(ws, d.id); } finally { prisma.metricSnapshot.findMany = real; }

      expect(r.status).toBe(EVIDENCE_STATUS.UNAVAILABLE);
      expect(r.baseline).toBeNull();
      expect(r.observation).toBeNull();
      expect(r.delta).toEqual({ spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null });
      // …and it is NOT the state a supported-but-empty account gets.
      expect(r.status).not.toBe(EVIDENCE_STATUS.NOT_OBSERVED);
    });
  });

  // ── T10 ──────────────────────────────────────────────────────
  describe('T10 · evidence that cannot be reconciled', () => {
    it('stays AMBIGUOUS rather than picking a reading', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 10_000, revenueMinor: 12_000 }));
      // A second reading of one observation day, taken at the SAME instant and
      // disagreeing. Nothing in the data ranks the two.
      const clash = W.observation.days[3];
      const sameInstant = new Date(`${clash}T00:00:00.000Z`);
      await prisma.metricSnapshot.updateMany({
        where: { workspaceId: ws, entityId, windowStart: sameInstant },
        data: { date: sameInstant },
      });
      await mkDaily(entityId, clash, { spendMinor: 99_999, revenueMinor: 1, observedAt: sameInstant });

      const r = await readOutcomeEvidence(ws, d.id);
      expect(r.status).toBe(EVIDENCE_STATUS.AMBIGUOUS);
      expect(r.delta).toEqual({ spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null });
      expect(r.ambiguousDays).toEqual([clash]);
    });

    it('withdraws the totals of the affected window, and only that one', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 10_000, revenueMinor: 12_000 }));
      const clash = W.observation.days[2];
      const sameInstant = new Date(`${clash}T00:00:00.000Z`);
      await prisma.metricSnapshot.updateMany({
        where: { workspaceId: ws, entityId, windowStart: sameInstant },
        data: { date: sameInstant },
      });
      await mkDaily(entityId, clash, { spendMinor: 12_345, revenueMinor: 6, observedAt: sameInstant });

      const r = await readOutcomeEvidence(ws, d.id);
      expect(r.status).toBe(EVIDENCE_STATUS.AMBIGUOUS);
      // The clash is in the observation window: its totals are unreproducible,
      // because reduceDay picks tied[0] from a sort that does not order equal
      // instants. They are withdrawn rather than published.
      expect(r.observation.spendMinor).toBeNull();
      expect(r.observation.revenueMinor).toBeNull();
      expect(r.observation.roas).toBeNull();
      // …while the baseline is untouched, deterministic, and still stated.
      expect(r.baseline.spendMinor).toBe(7 * 50_000);
      // Coverage and provenance survive on both sides — those are facts about
      // what exists, not numbers that could move.
      expect(r.observation.coverage.observed).toBe(7);
      expect(r.observation.refs).toHaveLength(7);
    });
  });

  // ── T11 — the load-bearing one ───────────────────────────────
  describe('T11 · observation does not learn', () => {
    it('changes no outcome, no pattern and no memory', async () => {
      const entityId = await mkCampaign();
      const d = await mkDecision(entityId);
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));
      await seedWindow(entityId, W.observation.days, () => ({ spendMinor: 10_000, revenueMinor: 12_000 }));

      const patternId = randomUUID();
      await prisma.accountPattern.create({
        data: {
          id: patternId, workspaceId: ws, patternKey: `T11|${patternId.slice(0, 8)}`,
          kind: 'FATIGUE_CEILING', statement: 'unchanged by observation',
          basis: 'seeded', metric: 'frequency', scopeLevel: 'CAMPAIGN', emitVerdict: 'KILL',
          threshold: 3.5, unit: 'RATIO', status: 'ESTABLISHED',
          accuracy: 0.95, confidence: 0.9, support: 6, effectiveSupport: 5,
          firstObservedAt: new Date(BOUNDARY.getTime() - 120 * DAY),
          lastObservedAt: new Date(BOUNDARY.getTime() - 5 * DAY),
        },
      });

      const snapshot = async () => ({
        outcomes: await prisma.outcomeSnapshot.count({ where: { workspaceId: ws } }),
        observations: await prisma.patternObservation.count({ where: { pattern: { workspaceId: ws } } }),
        memory: await prisma.decisionMemoryEntry.count({ where: { workspaceId: ws } }),
        pattern: await prisma.accountPattern.findUnique({
          where: { id: patternId },
          select: { support: true, effectiveSupport: true, accuracy: true, confidence: true, status: true },
        }),
      });

      const before = await snapshot();
      const r = await readOutcomeEvidence(ws, d.id);
      expect(r.status).toBe(EVIDENCE_STATUS.MEASURABLE);   // it really did read something
      const after = await snapshot();

      expect(after).toEqual(before);
    });

    it('the evidence module cannot write at all', () => {
      const src = readFileSync(
        fileURLToPath(new URL('./outcomeEvidenceComparison.js', import.meta.url)), 'utf8',
      ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

      for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
        expect(src).not.toMatch(new RegExp(`\\.${op}\\s*\\(`));
      }
      expect(src).not.toMatch(/\$executeRaw|\$transaction/);
      // …and it never reaches the one function that authors an outcome.
      expect(src).not.toMatch(/recordOutcome/);
    });
  });

  // ── T12 ──────────────────────────────────────────────────────
  describe('T12 · the operator path still learns', () => {
    it('observation → confirmation → outcome → learning is intact', async () => {
      const entities = [];
      const decisions = [];
      for (const ageDays of [40, 34, 28, 22]) {
        const entityId = await mkCampaign();
        const createdAt = new Date(Date.now() - ageDays * DAY);
        const d = await prisma.decision.create({
          data: {
            workspaceId: ws, entityId, entityLevel: 'CAMPAIGN', verdict: 'KILL',
            confidence: 0.7, diagnosis: 'learning fixture', rootCause: 'creative_fatigue',
            // C-10 — the pending-outcomes queue and the learning population are
            // both SIGNAL-scoped, and an unclassified row is correctly invisible
            // to them. This is what VerdictService writes.
            decisionClass: 'SIGNAL',
            createdAt, humanExecutedAt: new Date(createdAt.getTime() + DAY),
          },
        });
        // The population the learning sweep reads is ROLLING_WINDOW, not DAILY —
        // a distinction B5-01W measured and this fixture respects.
        await prisma.metricSnapshot.create({
          data: {
            workspaceId: ws, entityId, entityLevel: 'CAMPAIGN', source: 'META',
            date: createdAt, measurementWindow: 'ROLLING_WINDOW',
            frequency: 3.6, roas: 0.8, ctr: 0.009,
            spendMinor: 400_000, revenueMinor: 320_000, currency: 'USD',
          },
        });
        entities.push(entityId);
        decisions.push(d);
      }

      // The operator looks at the evidence first — which is allowed to say
      // "nothing observed" and must not stop them recording what they saw.
      const evidence = await readOutcomeEvidence(ws, decisions[0].id);
      expect(Object.values(EVIDENCE_STATUS)).toContain(evidence.status);

      const pendingBefore = await listPendingOutcomes(ws);
      expect(pendingBefore.decisions.some((x) => x.id === decisions[0].id)).toBe(true);

      for (const d of decisions) {
        const windowStart = new Date(new Date(d.humanExecutedAt).getTime() + DAY);
        const windowEnd = new Date(windowStart.getTime() + 7 * DAY);
        await recordOutcome(ws, d.id, {
          spendDeltaMinor: -120_000, revenueDeltaMinor: -60_000, roasDelta: 0.2,
          sustained: true, windowStart, windowEnd,
          measuredAt: new Date(windowEnd.getTime() + DAY),
        });
      }

      const pendingAfter = await listPendingOutcomes(ws);
      expect(pendingAfter.decisions.some((x) => x.id === decisions[0].id)).toBe(false);

      await getBriefing(ws, { now: new Date() });
      const pattern = await prisma.accountPattern.findFirst({
        where: { workspaceId: ws, statement: { not: 'unchanged by observation' } },
        select: { support: true, accuracy: true, status: true },
      });
      expect(pattern).not.toBeNull();
      expect(pattern.support).toBeGreaterThanOrEqual(4);
      expect(pattern.accuracy).toBe(1);
    });
  });

  // ── T13 ──────────────────────────────────────────────────────
  describe('T13 · the daily population stays out of operational truth', () => {
    it('selectOperationalSnapshots still cannot see a DAILY row', async () => {
      const entityId = await mkCampaign();
      await seedWindow(entityId, W.baseline.days, () => ({ spendMinor: 50_000, revenueMinor: 25_000 }));

      const rows = await selectOperationalSnapshots(ws, {
        entityIds: [entityId],
        select: { entityId: true, measurementWindow: true },
      });
      expect(rows).toEqual([]);
    });

    it('the comparison never touches the operational seam or queries snapshots itself', () => {
      const src = readFileSync(
        fileURLToPath(new URL('./outcomeEvidenceComparison.js', import.meta.url)), 'utf8',
      ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

      expect(src).not.toMatch(/selectOperationalSnapshots|OPERATIONAL_WINDOW_FILTER|OPERATIONAL_MEASUREMENT_WINDOWS/);
      // It reads the daily population THROUGH the reader that owns it — a second
      // metricSnapshot query here would be a fourth population selector, and
      // operationalIsolation's allow-list would (correctly) reject it.
      expect(src).not.toMatch(/prisma\.metricSnapshot\.findMany/);
      expect(src).toMatch(/readDailyObservations/);
    });
  });

  // ── subject refusals ─────────────────────────────────────────
  describe('refusals about the request, not about the account', () => {
    it('an unknown decision is not an evidence state', async () => {
      await expect(readOutcomeEvidence(ws, randomUUID()))
        .rejects.toMatchObject({ code: EVIDENCE_ERROR.DECISION_NOT_FOUND });
    });

    it('a decision nobody acted on has no boundary to measure around', async () => {
      const entityId = await mkCampaign();
      const d = await prisma.decision.create({
        data: {
          workspaceId: ws, entityId, entityLevel: 'CAMPAIGN', verdict: 'KILL',
          confidence: 0.7, diagnosis: 'never executed', rootCause: 'creative_fatigue',
        },
      });
      await expect(readOutcomeEvidence(ws, d.id))
        .rejects.toMatchObject({ code: EVIDENCE_ERROR.NOT_EXECUTED });
    });
  });
});
