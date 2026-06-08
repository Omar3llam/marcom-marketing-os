import { describe, it, expect } from 'vitest';
import { buildNarrativeInputs } from './NarrativeService.js';

const blended = {
  channels: [
    { channelId: 'acc-meta', channel: 'META', spendMinor: 400_000 },
    { channelId: 'acc-google', channel: 'GOOGLE', spendMinor: 250_000 },
  ],
  portfolio: { blendedRoas: 3.2, gapPct: 38, reconciledCount: 1, unverifiedCount: 1 },
};

const decisions = [
  { id: 'd1', verdict: 'KILL', entityId: 'as1', rootCause: null, outcomes: [{ id: 'o1', spendDeltaMinor: -120_000, revenueDeltaMinor: 0 }] },
  { id: 'd2', verdict: 'REALLOCATE', entityId: 'cmp1', rootCause: 'allocation:11111111-1111-1111-1111-111111111111', outcomes: [{ id: 'o2', spendDeltaMinor: 200_000 }] },
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

  it('derives allocation deltas only from REALLOCATE decisions citing a real plan', () => {
    expect(out.allocationDeltas).toHaveLength(1);
    expect(out.allocationDeltas[0].planId).toBe('11111111-1111-1111-1111-111111111111');
    expect(out.allocationDeltas[0].deltaMinor).toBe(200_000);
  });

  it('cites the top-spend channel real Account id for blended', () => {
    expect(out.blended.evidenceRef).toBe('acc-meta');
    expect(out.blended.blendedRoas).toBe(3.2);
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
