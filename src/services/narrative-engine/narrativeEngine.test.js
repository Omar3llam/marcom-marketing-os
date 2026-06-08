import { describe, it, expect } from 'vitest';
import { composeNarrative } from './narrativeEngine.js';
import { figure, confidenceScore, NARRATIVE_AUDIENCE, NARRATIVE_PERIOD, SECTION } from './narrativeTypes.js';

const decisions = [
  { id: 'd1', verdict: 'KILL', entityId: 'as1', entityLabel: 'Cold Prospecting #1', outcomeId: 'o1', spendDeltaMinor: -120_000, currency: 'EGP' },
  { id: 'd2', verdict: 'KILL', entityId: 'as2', entityLabel: 'Cold Prospecting #2', outcomeId: 'o2', spendDeltaMinor: -80_000, currency: 'EGP' },
  { id: 'd3', verdict: 'REALLOCATE', entityId: 'cmp1', entityLabel: 'PMax Warm', outcomeId: 'o3', spendDeltaMinor: 200_000, currency: 'EGP' },
];
const allocationDeltas = [
  { planId: 'p1', channel: 'PMax Warm', deltaMinor: 200_000, currency: 'EGP' },
  { planId: 'p1', channel: 'Meta Prospecting', deltaMinor: -200_000, currency: 'EGP' },
];
const blended = { evidenceRef: 'blend:meta', blendedRoas: 3.2, deltaPct: 12, gapPct: 38 };
const incrementality = [
  { testId: 't1', channel: 'META', liftPct: 17.0, ciLow: 0.012, ciHigh: 0.024, ciExcludesZero: true },
  { testId: 't2', channel: 'GOOGLE', liftPct: 4.0, ciLow: -0.01, ciHigh: 0.02, ciExcludesZero: false },
];
const goals = [
  { goalId: 'g1', name: 'Q3 Blended ROAS', status: 'AHEAD', targetValue: 3.5, unit: 'x', landingEstimate: 3.7 },
];
const coverage = { memoryCoverage: 0.8, incrementalityCoverage: 0.6, blendedConfidence: 0.9, attributionConfidence: 0.7 };

const base = {
  period: NARRATIVE_PERIOD.WEEKLY, periodStart: new Date('2026-06-01'), periodEnd: new Date('2026-06-08'),
  decisions, allocationDeltas, blended, incrementality, goals, coverage,
};

function allFigures(narrative) {
  return narrative.sections.flatMap((s) => s.claims.flatMap((c) => c.figures));
}

describe('narrativeEngine — the honesty invariant', () => {
  it('every figure in every section carries a non-empty evidenceRef (zero hallucination)', () => {
    const n = composeNarrative({ ...base, audience: NARRATIVE_AUDIENCE.STRATEGIST });
    const figs = allFigures(n);
    expect(figs.length).toBeGreaterThan(0);
    for (const f of figs) {
      expect(typeof f.evidenceRef).toBe('string');
      expect(f.evidenceRef.length).toBeGreaterThan(0);
      expect(typeof f.value).toBe('number');
      expect(Number.isNaN(f.value)).toBe(false);
    }
  });

  it('figure() THROWS when asked to emit a number without an evidenceRef', () => {
    expect(() => figure(1000, 'EGP', null)).toThrow();
    expect(() => figure(1000, 'EGP', '')).toThrow();
    expect(() => figure(1000, 'EGP', undefined)).toThrow();
    // and a non-number value is also refused
    expect(() => figure(NaN, 'EGP', 'o1')).toThrow();
  });

  it('evidenceRefs lists exactly the cited rows, de-duplicated', () => {
    const n = composeNarrative({ ...base, audience: NARRATIVE_AUDIENCE.STRATEGIST });
    const cited = new Set(allFigures(n).map((f) => f.evidenceRef));
    expect(new Set(n.evidenceRefs)).toEqual(cited);
    expect(n.evidenceRefs.length).toBe(new Set(n.evidenceRefs).size); // no dupes
  });
});

describe('narrativeEngine — audience scoping', () => {
  it('LEADERSHIP omits buyer execution detail and unproven causal claims', () => {
    const lead = composeNarrative({ ...base, audience: NARRATIVE_AUDIENCE.LEADERSHIP });
    const strat = composeNarrative({ ...base, audience: NARRATIVE_AUDIENCE.STRATEGIST });

    // no per-entity 'detail' claims survive for leadership
    const leadHasDetail = lead.sections.some((s) => s.claims.some((c) => c.tier === 'detail'));
    expect(leadHasDetail).toBe(false);
    const stratHasDetail = strat.sections.some((s) => s.claims.some((c) => c.tier === 'detail'));
    expect(stratHasDetail).toBe(true);

    // the inconclusive (proven:false) holdout claim is dropped for leadership
    const proved = lead.sections.find((s) => s.key === SECTION.PROVED);
    expect(proved.claims.every((c) => c.proven === true)).toBe(true);
    // strategist keeps the inconclusive one
    const stratProved = strat.sections.find((s) => s.key === SECTION.PROVED);
    expect(stratProved.claims.some((c) => c.proven === false)).toBe(true);
  });

  it('BUYER sees execution sections only (no strategic CHANGED/PROVED/GOAL)', () => {
    const buyer = composeNarrative({ ...base, audience: NARRATIVE_AUDIENCE.BUYER });
    const keys = buyer.sections.map((s) => s.key);
    expect(keys).toContain(SECTION.DID);
    expect(keys).not.toContain(SECTION.CHANGED);
    expect(keys).not.toContain(SECTION.PROVED);
    expect(keys).not.toContain(SECTION.GOAL);
  });
});

describe('narrativeEngine — honest empty state', () => {
  it('empty window yields a "no material changes" narrative, never invented data', () => {
    const n = composeNarrative({
      period: NARRATIVE_PERIOD.WEEKLY, audience: NARRATIVE_AUDIENCE.LEADERSHIP,
      decisions: [], allocationDeltas: [], blended: null, incrementality: [], goals: [], coverage: {},
    });
    expect(n.headline).toMatch(/no material changes/i);
    expect(allFigures(n).length).toBe(0); // no fabricated numbers
    expect(n.sections.length).toBe(1);
  });
});

describe('narrativeEngine — report confidence (itself defensible)', () => {
  it('returns a component breakdown, never a bare score', () => {
    const n = composeNarrative({ ...base, audience: NARRATIVE_AUDIENCE.LEADERSHIP });
    expect(typeof n.reportConfidence.score).toBe('number');
    expect(n.reportConfidence.components.length).toBe(4);
    const sumWeights = n.reportConfidence.components.reduce((s, c) => s + c.weight, 0);
    expect(sumWeights).toBeCloseTo(1.0, 5);
  });

  it('drops when coverage is partial (removing causal coverage lowers the score)', () => {
    const full = confidenceScore(coverage).score;
    const partial = confidenceScore({ ...coverage, incrementalityCoverage: 0 }).score;
    expect(partial).toBeLessThan(full);
  });

  it('clamps out-of-range coverage and never exceeds 100 or drops below 0', () => {
    expect(confidenceScore({ memoryCoverage: 5, incrementalityCoverage: 5, blendedConfidence: 5, attributionConfidence: 5 }).score).toBe(100);
    expect(confidenceScore({ memoryCoverage: -5 }).score).toBe(0);
  });
});

describe('narrativeEngine — determinism', () => {
  it('same input → byte-identical output', () => {
    const a = composeNarrative({ ...base, audience: NARRATIVE_AUDIENCE.STRATEGIST });
    const b = composeNarrative({ ...base, audience: NARRATIVE_AUDIENCE.STRATEGIST });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
