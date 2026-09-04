// ============================================================
// C-09 · the three dimensions, and the state matrix they must preserve
// ============================================================
// confidenceEngine multiplies sample × completeness × temporal and returns the
// product. All three functions are exported, documented and tested — and had
// ZERO callers outside this module. "Low confidence" could be published, and
// never WHICH of three things was low, nor which field was missing.
//
// C-09 publishes them. These tests pin the two rules that make publishing them
// honest rather than decorative:
//
//   1. NOTHING MOVES. The dimensions are a decomposition of a number that
//      already exists; if any published confidence changes, the slice is wrong.
//   2. A DIMENSION CARRIES ITS BASIS. temporalQuality 0.70 is produced by an
//      unknown age AND by a 5-day-old campaign — the same number answering two
//      different questions — so the number alone cannot be explained.
// ============================================================
import { describe, it, expect } from 'vitest';
import { COMPLETENESS_FIELD, COMPLETENESS_FIELD_VALUES } from '@marcom/runtime-contracts';
import {
  computeConfidence, computeConfidenceDimensions, foldConfidenceDimensions,
  sampleQuality, dataCompleteness, temporalQuality,
  GOOD_IMPRESSIONS, MAX_CONFIDENCE,
} from './confidenceEngine.js';

const FULL = {
  impressions: 20_000,
  daysRunning: 30,
  actionMetrics: { lpv: 10, atc: 5 },
  objective: 'OUTCOME_SALES',
  createdTime: new Date('2026-01-01T00:00:00Z'),
};

describe('C-09 · the dimensions are returned, not swallowed', () => {
  it('returns all three, each with the basis that makes it explainable', () => {
    const d = computeConfidenceDimensions({ ...FULL, impressions: 4_200, daysRunning: null });
    expect(d).toMatchObject({
      sampleQuality: 0.42,
      impressions: 4_200,
      dataCompleteness: 1,
      dataCompletenessMissingFields: [],
      temporalQuality: 0.7,
      daysRunning: null,
    });
  });

  it('folds back to exactly what computeConfidence already returned', () => {
    // RULE 1, as arithmetic. One computation, read two ways — never a second
    // implementation that happens to agree today.
    for (const args of [
      FULL,
      { ...FULL, impressions: 4_200 },
      { ...FULL, daysRunning: 1 },
      { ...FULL, actionMetrics: null, objective: null, createdTime: null, daysRunning: null },
      { impressions: 0 },
      { impressions: 999, daysRunning: 2 },
    ]) {
      expect(foldConfidenceDimensions(computeConfidenceDimensions(args)))
        .toBe(computeConfidence(args));
    }
  });

  it('still multiplies the three published numbers, capped', () => {
    const d = computeConfidenceDimensions(FULL);
    const raw = d.sampleQuality * d.dataCompleteness * d.temporalQuality;
    expect(foldConfidenceDimensions(d)).toBe(Math.min(Math.round(raw * 100) / 100, MAX_CONFIDENCE));
  });

  it('keeps the standalone dimension functions working — nothing is replaced', () => {
    expect(sampleQuality(4_200)).toBe(0.42);
    expect(temporalQuality(null)).toBe(0.7);
    expect(dataCompleteness({})).toBeCloseTo(0.55, 5);
    expect(GOOD_IMPRESSIONS).toBe(10_000);
  });
});

describe('C-09 · sample — unknown is not zero', () => {
  it('a measured zero is a real 0 with a real basis', () => {
    const d = computeConfidenceDimensions({ ...FULL, impressions: 0 });
    expect(d.sampleQuality).toBe(0);
    expect(d.impressions).toBe(0);
  });

  it('an UNKNOWN sample yields no dimensions at all — never sampleQuality 0', () => {
    // THE TRAP THIS SLICE MUST NOT WALK INTO. sampleQuality(undefined) returns 0
    // on its own, so a naive per-row publish would state "we measured zero
    // traffic" about a campaign whose traffic we were never given. The whole
    // object is absent instead, mirroring dataConfidence, which is already null
    // in exactly this case.
    expect(computeConfidenceDimensions({ ...FULL, impressions: undefined })).toBeNull();
    expect(computeConfidenceDimensions({ ...FULL, impressions: null })).toBeNull();
    expect(computeConfidenceDimensions({ ...FULL, impressions: Number.NaN })).toBeNull();
  });

  it('saturates at the same point the engine already used', () => {
    expect(computeConfidenceDimensions({ ...FULL, impressions: GOOD_IMPRESSIONS }).sampleQuality).toBe(1);
    expect(computeConfidenceDimensions({ ...FULL, impressions: GOOD_IMPRESSIONS * 5 }).sampleQuality).toBe(1);
  });
});

describe('C-09 · completeness — the amount AND the identities', () => {
  it('names every field the diagnosis could not see', () => {
    const d = computeConfidenceDimensions({
      impressions: 20_000, daysRunning: 30,
      actionMetrics: null, objective: null, createdTime: null,
    });
    expect([...d.dataCompletenessMissingFields].sort()).toEqual(
      [COMPLETENESS_FIELD.ATC, COMPLETENESS_FIELD.CREATED_TIME,
        COMPLETENESS_FIELD.LPV, COMPLETENESS_FIELD.OBJECTIVE].sort(),
    );
    expect(d.dataCompleteness).toBeCloseTo(0.55, 5);
  });

  it('names only what is actually missing', () => {
    const d = computeConfidenceDimensions({ ...FULL, actionMetrics: { lpv: 3 } });
    expect(d.dataCompletenessMissingFields).toEqual([COMPLETENESS_FIELD.ATC]);
    expect(d.dataCompleteness).toBeCloseTo(0.9, 5);
  });

  it('the list and the number always agree — every entry cost a penalty', () => {
    // The list is produced by the SAME pass that computes the number. A list
    // derived separately could disagree with it, and the createdTimeApplicable
    // branch below is exactly where that would happen first.
    for (const args of [
      FULL,
      { ...FULL, actionMetrics: null },
      { ...FULL, objective: null },
      { ...FULL, createdTime: null },
      { ...FULL, actionMetrics: null, objective: null, createdTime: null },
    ]) {
      const d = computeConfidenceDimensions(args);
      const withoutList = dataCompleteness(args);
      expect(d.dataCompleteness).toBeCloseTo(withoutList, 10);
      for (const f of d.dataCompletenessMissingFields) {
        expect(COMPLETENESS_FIELD_VALUES).toContain(f);
      }
    }
  });

  it('NOT APPLICABLE never appears as MISSING', () => {
    // An ad set has no creative age to withhold. The engine already declines to
    // charge it; the list must not name it either, or the two halves of the same
    // claim would contradict each other on the wire.
    const d = computeConfidenceDimensions({
      ...FULL, createdTime: null, createdTimeApplicable: false,
    });
    expect(d.dataCompletenessMissingFields).not.toContain(COMPLETENESS_FIELD.CREATED_TIME);
    expect(d.dataCompleteness).toBe(1);
  });

  it('an empty list means complete — never a missing list', () => {
    expect(computeConfidenceDimensions(FULL).dataCompletenessMissingFields).toEqual([]);
  });
});

describe('C-09 · temporal — the number is ambiguous, the basis is not', () => {
  it('0.70 is produced by an unknown age AND by a mid-band age', () => {
    // THE THIRD STATE. Both rows publish 0.7 and mean different things; only
    // daysRunning separates them, and it reaches no consumer today.
    const unknown = computeConfidenceDimensions({ ...FULL, daysRunning: null });
    const midBand = computeConfidenceDimensions({ ...FULL, daysRunning: 5 });

    expect(unknown.temporalQuality).toBe(0.7);
    expect(midBand.temporalQuality).toBe(0.7);
    expect(unknown.daysRunning).toBeNull();
    expect(midBand.daysRunning).toBe(5);
  });

  it('carries the age for every band', () => {
    expect(computeConfidenceDimensions({ ...FULL, daysRunning: 1 }))
      .toMatchObject({ temporalQuality: 0.4, daysRunning: 1 });
    expect(computeConfidenceDimensions({ ...FULL, daysRunning: 30 }))
      .toMatchObject({ temporalQuality: 1, daysRunning: 30 });
  });

  it('a non-finite age is reported as unknown, not as a number', () => {
    expect(computeConfidenceDimensions({ ...FULL, daysRunning: Number.NaN }).daysRunning).toBeNull();
    expect(computeConfidenceDimensions({ ...FULL, daysRunning: Number.NaN }).temporalQuality).toBe(0.7);
  });
});

describe('C-09 · the field vocabulary is shared, because the client must branch on it', () => {
  it('has exactly the four identities the penalties charge for', () => {
    expect(COMPLETENESS_FIELD_VALUES.slice().sort())
      .toEqual(['ATC', 'CREATED_TIME', 'LPV', 'OBJECTIVE']);
  });
});
