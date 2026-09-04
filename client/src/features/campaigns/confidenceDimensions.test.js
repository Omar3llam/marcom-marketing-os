// ============================================================
// C-09 · missing confidence stays missing (ruling B), and dimensions explain
// ============================================================
// `below(null) === false`, so a null half produced `limitedByData: false` — the
// panel said "Medium" with no qualifier when the truth was that we never knew
// the sample size. UNKNOWN was rendering as GOOD, on the confidence surface
// itself. Same class as C-03 and C-04, one layer up.
// ============================================================
import { describe, it, expect } from 'vitest';
import { COMPLETENESS_FIELD } from '@marcom/runtime-contracts';
import { confidenceDetail, describeConfidenceDimensions } from './verdictEvidence.js';

describe('C-09 · a missing half is never reported as a healthy one', () => {
  it('reports UNKNOWN, not false, when the data half was never computed', () => {
    const d = confidenceDetail({ confidence: 0.7, dataConfidence: null, signalConfidence: 0.9 });
    expect(d.limitedByData).toBeNull();
    expect(d.limitedBySignal).not.toBe(true);
  });

  it('reports UNKNOWN for a missing signal half too', () => {
    const d = confidenceDetail({ confidence: 0.7, dataConfidence: 0.9, signalConfidence: null });
    expect(d.limitedBySignal).toBeNull();
  });

  it('still says FALSE when the half is present and healthy', () => {
    // The distinction only means something if the negative answer survives.
    const d = confidenceDetail({ confidence: 0.85, dataConfidence: 0.9, signalConfidence: 0.95 });
    expect(d.limitedByData).toBe(false);
    expect(d.limitedBySignal).toBe(false);
  });

  it('still says TRUE when the half really is holding the number down', () => {
    const d = confidenceDetail({ confidence: 0.4, dataConfidence: 0.45, signalConfidence: 0.9 });
    expect(d.limitedByData).toBe(true);
  });

  it('a missing confidence produces no band at all', () => {
    expect(confidenceDetail({ confidence: null })).toBeNull();
  });
});

describe('C-09 · the dimensions are described, never recomputed', () => {
  const dims = {
    sampleQuality: 0.42, impressions: 4_200,
    dataCompleteness: 0.75, dataCompletenessMissingFields: [COMPLETENESS_FIELD.LPV, COMPLETENESS_FIELD.ATC],
    temporalQuality: 0.7, daysRunning: null,
  };

  it('returns one entry per dimension, each with its own basis', () => {
    const out = describeConfidenceDimensions(dims);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((e) => e.key))).toEqual(new Set(['sample', 'completeness', 'temporal']));
    for (const e of out) expect(e.detail).toBeTruthy();
  });

  it('separates an UNKNOWN age from a mid-band age, though both score 0.70', () => {
    // The third state, at the surface. Same number, two different sentences.
    const unknown = describeConfidenceDimensions(dims).find((e) => e.key === 'temporal');
    const midBand = describeConfidenceDimensions({ ...dims, daysRunning: 5 }).find((e) => e.key === 'temporal');
    expect(unknown.value).toBe(midBand.value);
    expect(unknown.detail).not.toBe(midBand.detail);
    expect(unknown.detail).toMatch(/not know|unknown/i);
  });

  it('names the missing fields rather than only how many', () => {
    const completeness = describeConfidenceDimensions(dims).find((e) => e.key === 'completeness');
    expect(completeness.detail).toMatch(/landing/i);
    expect(completeness.detail).not.toMatch(/^2 /);
  });

  it('says nothing is missing when nothing is', () => {
    const complete = describeConfidenceDimensions({
      ...dims, dataCompleteness: 1, dataCompletenessMissingFields: [],
    }).find((e) => e.key === 'completeness');
    expect(complete.detail).not.toMatch(/landing|objective/i);
  });

  it('never multiplies — a described set of dimensions produces no number of its own', () => {
    // THE INVARIANT, AS A TEST. The engine owns composition; this module may
    // show the parts and must never fold them back into a figure a reader could
    // mistake for the published confidence.
    const out = describeConfidenceDimensions(dims);
    for (const e of out) expect(Object.keys(e)).not.toContain('confidence');
    expect(describeConfidenceDimensions(null)).toEqual([]);
  });

  it('degrades to nothing when the row carries no dimensions', () => {
    expect(describeConfidenceDimensions(undefined)).toEqual([]);
  });
});
