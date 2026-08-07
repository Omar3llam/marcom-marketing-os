// ============================================================
// reasoningArtifact — the shape that gets frozen into the database
// ============================================================
// Every assertion here is about a promise to a reader who does not exist yet.
// These two columns are written once, never rewritten, and read by a learning
// query nobody has written — so the failure mode is not a crash. It is six
// months of rows in a shape that turns out to be unreadable, with no way to go
// back and fix them because the MetricSnapshots they were computed from are
// rolling aggregates that have long since been re-stamped.
//
// Three properties carry the value, and each is a way the record could be
// quietly worthless instead:
//   PROJECTED, NOT SPREAD — the stored shape must not track whatever the engine
//     happened to carry on the day, or one column holds six shapes.
//   CHECKABLE — an observation without its value and benchmark says "CTR was
//     weak" and can never be audited against the row it came from.
//   NULL ≠ [] — "never captured" and "the engine found none" are different
//     facts about different decisions.
import { describe, it, expect } from 'vitest';
import { toReasoningArtifact, toCounterfactualArtifact } from './reasoningArtifact.js';

const obs = (over = {}) => ({
  metric: 'CTR', value: 0.7, benchmark: 1.5, severity: 'CRITICAL', ...over,
});

const hypothesis = (over = {}) => ({
  id: 'CREATIVE_FATIGUE',
  labelKey: 'diagnosis.creativeFatigue',
  source: 'absolute',
  observed: [obs()],
  supports: ['CTR'],
  contradicts: [obs({ metric: 'FREQUENCY', value: 1.8, benchmark: 3.5, severity: 'HEALTHY' })],
  confidence: { reasoning: 0.8, data: 0.6 },
  ...over,
});

const counterfactual = (over = {}) => ({
  mechanism: 'AUDIENCE_MISMATCH',
  labelKey: 'diagnosis.audienceMismatch',
  rejectedBy: [obs({ metric: 'FREQUENCY', severity: 'HEALTHY' })],
  preferredBecause: [obs()],
  confidence: { reasoning: 0.4, data: 0.6 },
  ...over,
});

describe('toReasoningArtifact — the stored shape', () => {
  it('emits exactly the artifact keys, and no others', () => {
    const [out] = toReasoningArtifact([hypothesis()]);
    expect(Object.keys(out).sort()).toEqual(
      ['confidence', 'contradicts', 'id', 'labelKey', 'observed', 'source', 'supports'],
    );
  });

  // The reason this is a projection. A node is free to grow — a debug handle, a
  // back-reference to the entity that produced it — and a spread would freeze
  // whatever it carried that day into a column that outlives the field.
  it('drops anything the engine grew that is not part of the record', () => {
    const [out] = toReasoningArtifact([hypothesis({
      campaign: { id: 'c-1', spendMinor: 500_000, name: 'Ramadan Cold' },
      _debugTrace: ['rule-7', 'rule-9'],
      snapshot: { ctr: 0.007 },
    })]);

    expect(out.campaign).toBeUndefined();
    expect(out._debugTrace).toBeUndefined();
    // An entity blob would be a SECOND copy of the truth: a frozen campaign
    // spend inside a decision row, stale forever, disagreeing with the campaign.
    expect(out.snapshot).toBeUndefined();
  });

  it('keeps the enum key, never a rendered string', () => {
    const [out] = toReasoningArtifact([hypothesis()]);
    expect(out.id).toBe('CREATIVE_FATIGUE');
    expect(out.labelKey).toBe('diagnosis.creativeFatigue');
  });

  // The field most likely to be dismissed as noise, and the one a learning query
  // breaks without: a relative post-pass can re-decide the verdict from cohort
  // rank while leaving this reasoning untouched. Without the tag, reasoning that
  // merely ACCOMPANIED a verdict is indistinguishable from reasoning that
  // DECIDED it — and the absolute mechanism gets credited for the cohort's call.
  it('preserves which pass produced the reasoning', () => {
    expect(toReasoningArtifact([hypothesis()])[0].source).toBe('absolute');
  });

  it('keeps observations checkable — value and benchmark, not just a name', () => {
    const [out] = toReasoningArtifact([hypothesis()]);
    expect(out.observed[0]).toEqual({
      metric: 'CTR', value: 0.7, benchmark: 1.5, severity: 'CRITICAL',
    });
  });

  it('keeps both halves of confidence', () => {
    // reasoning is the rule's strength, data is the input quality. Collapsing
    // them loses which one made a low score low.
    expect(toReasoningArtifact([hypothesis()])[0].confidence).toEqual({ reasoning: 0.8, data: 0.6 });
  });

  it('carries contradicts as full readings, not bare metric names', () => {
    const [out] = toReasoningArtifact([hypothesis()]);
    expect(out.contradicts[0]).toMatchObject({ metric: 'FREQUENCY', value: 1.8, benchmark: 3.5 });
  });

  it('keeps supports as names — the figures already live in observed', () => {
    expect(toReasoningArtifact([hypothesis()])[0].supports).toEqual(['CTR']);
  });

  it('preserves rank order — hypotheses[0] is the primary', () => {
    const out = toReasoningArtifact([
      hypothesis({ id: 'CREATIVE_FATIGUE' }),
      hypothesis({ id: 'AUDIENCE_MISMATCH' }),
    ]);
    expect(out.map((h) => h.id)).toEqual(['CREATIVE_FATIGUE', 'AUDIENCE_MISMATCH']);
  });
});

describe('toReasoningArtifact — null is not empty', () => {
  // The distinction the migration deliberately preserves. A row written before
  // this PR has null; a campaign that tripped the 1 000-impression gate has [].
  // Mapping empty to null would make a thin campaign indistinguishable from a
  // historical row, and a learning query counting "decisions we reasoned about"
  // would silently exclude every early-gate call.
  it('an empty list stays empty — the engine ran and found nothing', () => {
    expect(toReasoningArtifact([])).toEqual([]);
  });

  it.each([[null], [undefined], ['not-an-array'], [{}], [42]])(
    'a non-array (%s) is null — never captured', (input) => {
      expect(toReasoningArtifact(input)).toBeNull();
    });

  it('survives a malformed row rather than throwing mid-sweep', () => {
    // This runs inside persistNode. A throw here costs the sweep the verdict it
    // was writing — the load-bearing row — for the sake of a field nobody reads
    // yet. Degrade to nulls instead.
    const [out] = toReasoningArtifact([{}]);
    expect(out).toEqual({
      id: null, labelKey: null, source: null,
      supports: [], contradicts: [], observed: [], confidence: null,
    });
    expect(() => toReasoningArtifact([null, undefined])).not.toThrow();
  });

  it('does not mutate what it was given', () => {
    const input = [hypothesis()];
    const before = JSON.stringify(input);
    toReasoningArtifact(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('copies supports rather than aliasing the engine array', () => {
    const input = [hypothesis()];
    const out = toReasoningArtifact(input);
    out[0].supports.push('MUTATED');
    expect(input[0].supports).toEqual(['CTR']);
  });
});

describe('toCounterfactualArtifact — the half that cannot be rebuilt', () => {
  it('emits exactly the artifact keys', () => {
    const [out] = toCounterfactualArtifact([counterfactual()]);
    expect(Object.keys(out).sort()).toEqual(
      ['confidence', 'labelKey', 'mechanism', 'preferredBecause', 'rejectedBy'],
    );
  });

  it('drops anything else the engine attached', () => {
    const [out] = toCounterfactualArtifact([counterfactual({
      adSet: { id: 'as-1', ctr: 0.003 }, _rulesRun: 12,
    })]);
    expect(out.adSet).toBeUndefined();
    expect(out._rulesRun).toBeUndefined();
  });

  // preferredBecause is the whole reason to store these. It is the primary's
  // evidence that the alternative would have left UNEXPLAINED — computed from
  // MetricSnapshot readings that are rolling per-sync aggregates. Once the next
  // sync lands, nothing in the database can reconstruct this comparison.
  it('keeps preferredBecause as full readings', () => {
    const [out] = toCounterfactualArtifact([counterfactual()]);
    expect(out.preferredBecause[0]).toEqual({
      metric: 'CTR', value: 0.7, benchmark: 1.5, severity: 'CRITICAL',
    });
  });

  it('keeps rejectedBy as full readings', () => {
    const [out] = toCounterfactualArtifact([counterfactual()]);
    expect(out.rejectedBy[0]).toMatchObject({ metric: 'FREQUENCY', severity: 'HEALTHY' });
  });

  // The alternative's own score, not the primary's. How strong the thing being
  // set aside was is the entire question a counterfactual answers.
  it('carries the ALTERNATIVE confidence', () => {
    expect(toCounterfactualArtifact([counterfactual()])[0].confidence)
      .toEqual({ reasoning: 0.4, data: 0.6 });
  });

  // buildCounterfactuals returns [] below two hypotheses: with nothing to
  // compare against there was no alternative to set aside. A real answer.
  it('an empty list stays empty', () => {
    expect(toCounterfactualArtifact([])).toEqual([]);
  });

  it.each([[null], [undefined], ['nope']])('a non-array (%s) is null', (input) => {
    expect(toCounterfactualArtifact(input)).toBeNull();
  });

  it('survives a malformed row', () => {
    expect(toCounterfactualArtifact([{}])[0]).toEqual({
      mechanism: null, labelKey: null, rejectedBy: [], preferredBecause: [], confidence: null,
    });
  });
});

// The artifacts land in JSONB. Anything that does not survive a round-trip is
// data the column silently loses.
describe('JSON round-trip', () => {
  it('survives serialization unchanged', () => {
    const stored = toReasoningArtifact([hypothesis()]);
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });

  it('counterfactuals survive too', () => {
    const stored = toCounterfactualArtifact([counterfactual()]);
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });

  // undefined vanishes through JSON. Every absent field is an explicit null so
  // a stored row cannot come back missing keys it was written with.
  it('has no undefined values to lose', () => {
    const stored = toReasoningArtifact([{}]);
    expect(JSON.stringify(stored)).toContain('"id":null');
    expect(Object.values(stored[0]).some((v) => v === undefined)).toBe(false);
  });
});
