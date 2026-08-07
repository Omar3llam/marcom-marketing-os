// ============================================================
// counterfactualViewModel — enum keys become sentences, once
// ============================================================
// The engine speaks enum keys and never prose. This is the only place on the
// client where that changes, so the tests are about two things:
//
//   THE FALLBACK CHAIN — a key the map has not caught up with must degrade to
//     something true rather than to nothing. Dropping a row would understate the
//     reasoning behind a decision, and inventing a sentence would overstate it.
//
//   THE ABSENCE OF JUDGEMENT — no sort, no filter, no threshold. The engine
//     already decided what was set aside and in what order; a second opinion
//     here would put something on screen that no stored decision can be audited
//     against.
import { describe, it, expect } from 'vitest';
import { buildCounterfactualViewModel } from './counterfactualViewModel.js';
import { REASONING_LABELS } from './verdictEvidence.js';

const obs = (metric, over = {}) => ({
  metric, value: 1.2, benchmark: 1.5, severity: 'HEALTHY', ...over,
});

const cf = (over = {}) => ({
  mechanism: 'AUDIENCE_MISMATCH',
  labelKey: 'diagnosis.audienceMismatch',
  rejectedBy: [obs('CPC')],
  preferredBecause: [obs('CTR', { severity: 'CRITICAL' })],
  confidence: { reasoning: 0.4, data: 0.6 },
  ...over,
});

describe('the mechanism label', () => {
  it('reads the map first', () => {
    expect(buildCounterfactualViewModel([cf()])[0].label).toBe('Audience mismatch');
  });

  // The engine's own name for the thing: worse than a written sentence, far
  // better than admitting we have no idea what it said.
  it('falls back to the engine labelKey for a mechanism the map has not caught up with', () => {
    const [out] = buildCounterfactualViewModel([cf({ mechanism: 'UNKNOWN_X', labelKey: 'custom' })]);
    expect(out.label).toBe('custom');
  });

  it('falls back to a placeholder only when there is nothing at all', () => {
    const [out] = buildCounterfactualViewModel([cf({ mechanism: 'UNKNOWN_X', labelKey: undefined })]);
    expect(out.label).toBe('Unknown mechanism');
  });

  it('carries the raw mechanism through for the caller key', () => {
    expect(buildCounterfactualViewModel([cf()])[0].mechanism).toBe('AUDIENCE_MISMATCH');
  });
});

describe('the metric lines', () => {
  // Same metric, opposite roles. A HEALTHY CTR argued AGAINST an alternative; a
  // weak one is what the primary rests ON. One sentence for both would have to
  // be vague enough to say nothing.
  it('reads a rejection and a support differently', () => {
    const [out] = buildCounterfactualViewModel([cf({
      rejectedBy: [obs('CTR')], preferredBecause: [obs('CTR')],
    })]);
    expect(out.rejectedBy[0].label).toBe('Click-through rate was healthy');
    expect(out.preferredBecause[0].label).toBe('CTR is below benchmark');
  });

  it.each([['CPC'], ['CONV_RATE'], ['CPL'], ['FREQUENCY'], ['SPEND']])(
    'has both readings for %s', (metric) => {
      expect(REASONING_LABELS.metrics[metric].rejected).toEqual(expect.any(String));
      expect(REASONING_LABELS.metrics[metric].preferred).toEqual(expect.any(String));
    });

  // The trap diagnosisTypes warns about over MECHANISM_SUPPORT: observations
  // carry the UPPERCASE display vocabulary, never the lowercase signal-input
  // field names. A lowercase key here matches nothing and the user reads a
  // field name where a sentence belongs.
  it('is keyed on the UPPERCASE display vocabulary, not the input field names', () => {
    expect(REASONING_LABELS.metrics.ctr).toBeUndefined();
    expect(REASONING_LABELS.metrics.cpcMinor).toBeUndefined();
    expect(Object.keys(REASONING_LABELS.metrics)).toEqual(
      expect.arrayContaining(['CTR', 'FREQUENCY', 'CPC', 'CONV_RATE', 'CPL', 'SPEND']),
    );
  });

  it('falls back to the raw metric name rather than dropping the row', () => {
    const [out] = buildCounterfactualViewModel([cf({ rejectedBy: [obs('NEW_METRIC')] })]);
    expect(out.rejectedBy).toHaveLength(1);
    expect(out.rejectedBy[0].label).toBe('NEW_METRIC');
  });

  it('says Unknown signal only when there is no metric at all', () => {
    const [out] = buildCounterfactualViewModel([cf({ rejectedBy: [{}] })]);
    expect(out.rejectedBy[0].label).toBe('Unknown signal');
  });

  it('keys each line by metric and position', () => {
    const [out] = buildCounterfactualViewModel([cf({ rejectedBy: [obs('CPC'), obs('CONV_RATE')] })]);
    expect(out.rejectedBy.map((l) => l.key)).toEqual(['CPC-0', 'CONV_RATE-1']);
  });

  it('keeps keys unique when the same metric appears twice', () => {
    const [out] = buildCounterfactualViewModel([cf({ rejectedBy: [obs('CPC'), obs('CPC')] })]);
    const keys = out.rejectedBy.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('it makes no judgements', () => {
  // The rule this file exists to hold. The engine ranked these; re-ordering,
  // filtering or scoring here would put a second opinion on screen that no
  // stored decision can be audited against.
  it('preserves the engine order exactly', () => {
    const out = buildCounterfactualViewModel([
      cf({ mechanism: 'AUDIENCE_MISMATCH' }),
      cf({ mechanism: 'LOW_CTR' }),
      cf({ mechanism: 'CREATIVE_FATIGUE' }),
    ]);
    expect(out.map((o) => o.mechanism)).toEqual(['AUDIENCE_MISMATCH', 'LOW_CTR', 'CREATIVE_FATIGUE']);
  });

  it('drops nothing — a counterfactual with no evidence still appears', () => {
    const out = buildCounterfactualViewModel([cf({ rejectedBy: [], preferredBecause: [] })]);
    expect(out).toHaveLength(1);
    expect(out[0].rejectedBy).toEqual([]);
  });

  it('never reads confidence — ranking is not this file to redo', () => {
    const [out] = buildCounterfactualViewModel([cf({ confidence: { reasoning: 0.01, data: 0.01 } })]);
    expect(out).not.toHaveProperty('confidence');
    expect(out.label).toBe('Audience mismatch'); // present regardless of how weak
  });

  it('does not mutate its input', () => {
    const input = [cf()];
    const before = JSON.stringify(input);
    buildCounterfactualViewModel(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('nothing usable in, empty list out', () => {
  it.each([[null], [undefined], [[]], ['nope'], [{}], [42]])(
    '%s becomes []', (input) => {
      expect(buildCounterfactualViewModel(input)).toEqual([]);
    });

  // This runs on a network payload. A malformed row must not blank the panel it
  // is one block of.
  it('survives a malformed row', () => {
    expect(() => buildCounterfactualViewModel([null, undefined, {}])).not.toThrow();
    const out = buildCounterfactualViewModel([{}]);
    expect(out[0]).toEqual({
      mechanism: null, label: 'Unknown mechanism', rejectedBy: [], preferredBecause: [],
    });
  });
});
