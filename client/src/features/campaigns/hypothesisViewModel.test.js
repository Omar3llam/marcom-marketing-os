// ============================================================
// hypothesisViewModel — the primary, and when it must stay silent
// ============================================================
// Two rules carry this file, and both are about NOT showing something:
//
//   [0] ONLY — buildCounterfactuals is `hypotheses.slice(1)`, so every
//     hypothesis after the first is already on screen as a counterfactual.
//     Rendering the array would print each alternative twice, once as a live
//     candidate and once as rejected, over the same evidence.
//
//   THE HONESTY GATE — the relative post-pass can re-decide a verdict from
//     cohort rank while leaving the absolute pass's reasoning untouched. That
//     reasoning describes the campaign but did not decide the call, and showing
//     it would send a marketer to fix a mechanism that had nothing to do with
//     the verdict. Wrong attribution is worse than none.
import { describe, it, expect } from 'vitest';
import { buildPrimaryHypothesisViewModel } from './hypothesisViewModel.js';

const obs = (metric, over = {}) => ({
  metric, value: 0.7, benchmark: 1.5, severity: 'CRITICAL', ...over,
});

const h = (over = {}) => ({
  id: 'CREATIVE_FATIGUE',
  labelKey: 'diagnosis.creativeFatigue',
  source: 'absolute',
  observed: [obs('CTR'), obs('FREQUENCY', { value: 4.2, benchmark: 3.5 })],
  supports: ['CTR', 'FREQUENCY'],
  contradicts: [],
  confidence: { reasoning: 0.8, data: 0.6 },
  ...over,
});

describe('the primary, and only the primary', () => {
  it('reads hypotheses[0]', () => {
    const vm = buildPrimaryHypothesisViewModel([h(), h({ id: 'AUDIENCE_MISMATCH' })], null);
    expect(vm.id).toBe('CREATIVE_FATIGUE');
  });

  // The duplication this prevents: hypotheses[1..n] ARE the counterfactuals
  // (buildCounterfactuals is a slice(1)), already rendered by the block above.
  it('returns one view model, never a list', () => {
    const vm = buildPrimaryHypothesisViewModel([h(), h({ id: 'AUDIENCE_MISMATCH' }), h({ id: 'LOW_CTR' })], null);
    expect(Array.isArray(vm)).toBe(false);
    expect(vm.id).toBe('CREATIVE_FATIGUE');
  });

  it('labels from the map', () => {
    expect(buildPrimaryHypothesisViewModel([h()], null).label).toBe('Creative fatigue');
  });

  it('falls back to labelKey, then to a placeholder', () => {
    expect(buildPrimaryHypothesisViewModel([h({ id: 'NEW_X', labelKey: 'custom' })], null).label).toBe('custom');
    expect(buildPrimaryHypothesisViewModel([h({ id: 'NEW_X', labelKey: undefined })], null).label)
      .toBe('Unknown mechanism');
  });
});

describe('the honesty gate', () => {
  // The case it exists for: a bottom-of-cohort HOLD upgraded to KILL by the
  // relative pass. The absolute hypotheses still describe the campaign, and they
  // did not decide the verdict — attributing the KILL to "creative fatigue"
  // would send someone to rewrite a creative the engine never blamed.
  it.each([['TOP'], ['BOTTOM']])('stays silent when the cohort pass (%s) decided the verdict', (rank) => {
    expect(buildPrimaryHypothesisViewModel([h({ source: 'absolute' })], rank)).toBeNull();
  });

  it('renders when the absolute pass decided it', () => {
    expect(buildPrimaryHypothesisViewModel([h()], null)).not.toBeNull();
  });

  // Written on `source`, not on relativeRank alone. Today every projected
  // hypothesis is tagged 'absolute', so the two forms behave identically — but
  // the day a relative pass produces its OWN reasoning, that reasoning SHOULD
  // show, and the short version would hide it forever.
  it('renders reasoning that a relative pass produced itself', () => {
    const vm = buildPrimaryHypothesisViewModel([h({ source: 'relative' })], 'BOTTOM');
    expect(vm).not.toBeNull();
    expect(vm.id).toBe('CREATIVE_FATIGUE');
  });
});

describe('the supporting readings', () => {
  it('uses the "preferred" reading — these argue FOR the primary', () => {
    const vm = buildPrimaryHypothesisViewModel([h()], null);
    expect(vm.observed.map((o) => o.label))
      .toEqual(['CTR is below benchmark', 'Frequency is above the ceiling']);
  });

  it('keys by metric and position', () => {
    expect(buildPrimaryHypothesisViewModel([h()], null).observed.map((o) => o.key))
      .toEqual(['CTR-0', 'FREQUENCY-1']);
  });

  it('falls back to the raw metric rather than dropping a reading', () => {
    const vm = buildPrimaryHypothesisViewModel([h({ observed: [obs('NEW_METRIC')] })], null);
    expect(vm.observed[0].label).toBe('NEW_METRIC');
  });

  it('is empty, not absent, when the hypothesis rests on nothing graded', () => {
    expect(buildPrimaryHypothesisViewModel([h({ observed: [] })], null).observed).toEqual([]);
  });
});

describe('what the model deliberately omits', () => {
  // `supports` is metric NAMES for a hypothesis whose figures are already in
  // `observed`. Nothing renders it, and a projected-but-unrendered field reads
  // as a rendering bug to whoever finds it next.
  // TODO (PR#334): joins the model with the confidence breakdown.
  it('does not project supports', () => {
    expect(buildPrimaryHypothesisViewModel([h()], null)).not.toHaveProperty('supports');
  });

  it('does not project contradicts — those belong to the counterfactuals', () => {
    expect(buildPrimaryHypothesisViewModel([h()], null)).not.toHaveProperty('contradicts');
  });

  it('carries confidence through even though nothing shows it yet', () => {
    expect(buildPrimaryHypothesisViewModel([h()], null).confidence)
      .toEqual({ reasoning: 0.8, data: 0.6 });
  });

  it('emits exactly four keys', () => {
    expect(Object.keys(buildPrimaryHypothesisViewModel([h()], null)).sort())
      .toEqual(['confidence', 'id', 'label', 'observed']);
  });
});

describe('nothing usable in, null out', () => {
  it.each([[null], [undefined], [[]], ['nope'], [{}], [[null]]])('%s becomes null', (input) => {
    expect(buildPrimaryHypothesisViewModel(input, null)).toBeNull();
  });

  it('makes no judgement of its own', () => {
    // No sort, no filter, no threshold: a weak primary is still the primary.
    const vm = buildPrimaryHypothesisViewModel([h({ confidence: { reasoning: 0.01, data: 0.01 } })], null);
    expect(vm.label).toBe('Creative fatigue');
  });

  it('does not mutate its input', () => {
    const input = [h()];
    const before = JSON.stringify(input);
    buildPrimaryHypothesisViewModel(input, null);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('survives a malformed row', () => {
    expect(() => buildPrimaryHypothesisViewModel([{}], null)).not.toThrow();
    expect(buildPrimaryHypothesisViewModel([{}], null)).toEqual({
      id: null, label: 'Unknown mechanism', observed: [], confidence: null,
    });
  });
});
