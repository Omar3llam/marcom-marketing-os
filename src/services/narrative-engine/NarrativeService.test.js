import { describe, it, expect } from 'vitest';
import { buildNarrativeInputs, serializeNarrative } from './NarrativeService.js';

const blended = {
  channels: [
    { channelId: 'acc-meta', channel: 'META', spendMinor: 400_000 },
    { channelId: 'acc-google', channel: 'GOOGLE', spendMinor: 250_000 },
  ],
  portfolio: { blendedRevenueEfficiency: { status: 'VALID', value: 3.2 }, gapPct: 38, reconciledCount: 1, unverifiedCount: 1 },
};

const decisions = [
  { id: 'd1', verdict: 'KILL', entityId: 'as1', rootCause: null, decisionClass: 'SIGNAL', outcomes: [{ id: 'o1', spendDeltaMinor: -120_000, revenueDeltaMinor: 0 }] },
  // C-10 — the CLASS is what makes this an allocation move; `rootCause` still
  // carries WHICH plan, which is the subtype payload the section reads.
  { id: 'd2', verdict: 'REALLOCATE', entityId: 'cmp1', rootCause: 'allocation:11111111-1111-1111-1111-111111111111', decisionClass: 'ALLOCATION', outcomes: [{ id: 'o2', spendDeltaMinor: 200_000 }] },
];

const concludedTests = [
  { id: 't1', channel: 'META', liftPct: 17, ciLow: 0.012, ciHigh: 0.024 },
];
const patterns = [{ status: 'ESTABLISHED' }, { status: 'ESTABLISHED' }, { status: 'EMERGING' }];
const goals = [{ id: 'g1', name: 'Q3 ROAS', status: 'AHEAD', targetValue: 3.5, metric: 'blendedRoas' }];
const labelsById = new Map([['as1', 'Cold #1'], ['cmp1', 'PMax Warm']]);

describe('buildNarrativeInputs', () => {
  const out = buildNarrativeInputs({
    decisions,
    allocationPlanIds: new Set(['11111111-1111-1111-1111-111111111111']),
    blended, concludedTests, goals, patterns, labelsById,
    currency: 'EGP', measurementTier: 'ENTERPRISE',
  });

  it('maps decisions with their outcome ids (so figures can cite real rows)', () => {
    expect(out.decisions[0].outcomeId).toBe('o1');
    expect(out.decisions[0].entityLabel).toBe('Cold #1');
  });

  it('withholds OutcomeSnapshot monetary deltas even when an allocation plan is linked', () => {
    expect(out.allocationDeltas).toEqual([]);
    expect(out.decisions[0].spendDeltaMinor).toBeNull();
    expect(out.decisions[1].spendDeltaMinor).toBeNull();
    expect(out.decisions[1].monetaryReason).toBe('OUTCOME_MONETARY_BASIS_UNPROVEN');
  });

  it('cites the top-spend channel real Account id for blended', () => {
    expect(out.blended.evidenceRef).toBe('acc-meta');
    expect(out.blended.blendedRoas).toBe(3.2);
  });
  it('includes incomparable channels in coverage and inherits only the authoritative gap', () => {
    const result = buildNarrativeInputs({ blended: { ...blended, portfolio: { ...blended.portfolio,
      reconciledCount: 1, unverifiedCount: 1, unavailableCount: 2, gapPct: 999,
      reconciliation: { status: 'UNAVAILABLE', gapPct: null } } } });
    expect(result.coverage.blendedConfidence).toBe(.25);
    expect(result.blended.gapPct).toBeNull();
    const available = buildNarrativeInputs({ blended: { ...blended, portfolio: { ...blended.portfolio,
      reconciliation: { status: 'AVAILABLE', gapPct: 0 } } } });
    expect(available.blended.gapPct).toBe(0);
  });

  it('flags ciExcludesZero from the interval', () => {
    expect(out.incrementality[0].ciExcludesZero).toBe(true);
  });

  it('computes coverage signals from real rows (memory 2/3, blended 1/2)', () => {
    expect(out.coverage.memoryCoverage).toBeCloseTo(2 / 3, 5);
    expect(out.coverage.blendedConfidence).toBeCloseTo(0.5, 5);
    expect(out.coverage.incrementalityCoverage).toBeCloseTo(0.5, 5); // 1 tested of 2 channels
    expect(out.coverage.attributionConfidence).toBeGreaterThan(0);
  });

  it('coverage is honestly zero when the rows are absent', () => {
    const empty = buildNarrativeInputs({});
    expect(empty.coverage.memoryCoverage).toBe(0);
    expect(empty.coverage.incrementalityCoverage).toBe(0);
    expect(empty.coverage.blendedConfidence).toBe(0);
    expect(empty.blended).toBe(null);
    expect(empty.allocationDeltas).toEqual([]);
  });
});

describe('serializeNarrative — one wire shape for list/detail/generate', () => {
  it('rebuilds reportConfidence + sections from a persisted DB row (band derived from score)', () => {
    const row = {
      id: 'n1', period: 'WEEKLY', audience: 'LEADERSHIP',
      periodStart: new Date('2026-06-16'), periodEnd: new Date('2026-06-23'),
      headline: '2 actions this period.',
      body: { sections: [{ key: 'DID', title: 'What we did', claims: [] }] },
      evidenceRefs: ['o1', 't1'],
      confidenceScore: 82,
      confidenceBasis: [{ key: 'memoryCoverage', weight: 0.3, value: 1 }],
      createdAt: new Date('2026-06-23'),
    };
    const out = serializeNarrative(row);
    expect(out.sections).toHaveLength(1);
    expect(out.reportConfidence).toEqual({
      score: 82, label: 'HIGH',
      components: [{ key: 'memoryCoverage', weight: 0.3, value: 1 }],
    });
    expect(out.evidenceRefs).toEqual(['o1', 't1']);
    // The raw-row keys are NOT leaked onto the contract shape.
    expect(out.body).toBeUndefined();
    expect(out.confidenceScore).toBeUndefined();
  });

  it('passes a freshly-composed result (sections + reportConfidence already present) through unchanged', () => {
    const composed = {
      id: 'n2', period: 'MONTHLY', audience: 'STRATEGIST',
      periodStart: null, periodEnd: null, headline: 'No material changes this period.',
      sections: [{ key: 'DID', title: 'What we did', claims: [] }],
      reportConfidence: { score: 40, label: 'LOW', components: [{ key: 'x', weight: 1, value: 0.4 }] },
      evidenceRefs: [],
      // a generate() result also carries the raw row fields — they must be dropped
      body: { sections: [] }, confidenceScore: 40, confidenceBasis: [],
    };
    const out = serializeNarrative(composed);
    expect(out.reportConfidence.label).toBe('LOW');
    expect(out.sections).toBe(composed.sections);
    expect(out.body).toBeUndefined();
  });

  it('is null-safe (a missing narrative serialises to null, not a throw)', () => {
    expect(serializeNarrative(null)).toBe(null);
  });
});
