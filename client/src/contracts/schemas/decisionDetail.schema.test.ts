// ============================================================
// B8-04 — the Decision detail crosses the client boundary intact
// ------------------------------------------------------------
// C-13's F-6 is the standing warning: C-10 published `decisionClass` and the
// client's zod schema STRIPPED it, so the cure could never have had a consumer.
// The detail payload is the densest thing Lumi publishes — a committed block
// where every field carries its own C-06 knowledge token, three closure axes,
// and the memory measured at commitment — so every one of those is asserted
// here rather than assumed to survive.
//
// The committed block is what makes this surface possible at all: a field's
// null is ambiguous on its own, and `knowledge` is what disambiguates it.
// Dropping the token would leave the page unable to tell "this class never
// records that" from "we could not establish it".
// ============================================================
import { describe, it, expect } from 'vitest';
import { DecisionDetailSchema } from './decisionDetail.schema';

/** A SIGNAL decision as `detailBody()` emits it. */
const signal = {
  id: 'd1',
  decisionClass: 'SIGNAL',
  entityId: 'c1',
  entityLevel: 'CAMPAIGN',
  decidedAt: '2026-09-01T00:00:00.000Z',
  verdict: 'KILL',
  confidence: 0.71,
  diagnosis: 'ROAS below floor for 14 days',
  rootCause: 'signal:roas',
  status: 'SUPERSEDED',
  explainedAt: '2026-09-02T00:00:00.000Z',
  intentAt: null,
  humanExecutedAt: null,
  platformExecutedAt: null,
  dismissedAt: null,
  resolvedAt: null,
  resolution: null,
  confidenceDelta: null,
  closureReason: null,
  humanResponse: null,
  humanReasonCode: null,
  humanReasonNote: null,
  humanRespondedAt: null,
  guardrailRuleId: null,
  openHitKey: null,
  memoryProvenance: {
    factor: 0.89,
    applied: true,
    patterns: [{ patternId: 'p1', statement: 'KILL calls hold', accuracy: 0.8, effectiveSupport: 12 }],
  },
  baseConfidence: 0.8,
  memoryStatus: 'OK',
  committed: {
    ctrAtDecision:     { value: 0.012, knowledge: 'KNOWN' },
    roasAtDecision:    { value: 0.4, knowledge: 'KNOWN' },
    objective:         { value: 'CONVERSIONS', knowledge: 'KNOWN' },
    channel:           { value: 'META', knowledge: 'KNOWN' },
    hypotheses:        { value: [{ statement: 'creative fatigue' }], knowledge: 'KNOWN' },
    counterfactuals:   { value: [], knowledge: 'NOTHING_THERE' },
    evidenceReference: { value: null, knowledge: 'COULD_NOT_LOOK' },
  },
};

describe('B8-04 · the detail payload parses whole', () => {
  it('accepts a SIGNAL decision as the backend emits it', () => {
    const r = DecisionDetailSchema.safeParse(signal);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('keeps decisionClass — the field C-13 caught a schema stripping', () => {
    const r = DecisionDetailSchema.safeParse(signal);
    if (!r.success) throw new Error('parse failed');
    expect(r.data.decisionClass).toBe('SIGNAL');
  });

  it('keeps the memory measured at commitment, by VALUE', () => {
    const r = DecisionDetailSchema.safeParse(signal);
    if (!r.success) throw new Error('parse failed');
    // C-16 froze the patterns by value precisely so a later sweep rewriting the
    // pattern row cannot change what this Decision reports.
    expect(r.data.memoryProvenance?.patterns?.[0]?.statement).toBe('KILL calls hold');
    expect(r.data.baseConfidence).toBe(0.8);
    expect(r.data.memoryStatus).toBe('OK');
  });

  it('keeps every committed field WITH its knowledge token', () => {
    const r = DecisionDetailSchema.safeParse(signal);
    if (!r.success) throw new Error('parse failed');
    expect(r.data.committed.counterfactuals.knowledge).toBe('NOTHING_THERE');
    expect(r.data.committed.evidenceReference.knowledge).toBe('COULD_NOT_LOOK');
    // The token is what separates "we looked and there is nothing" from "we
    // could not look". A schema that dropped it would erase the distinction the
    // whole surface rests on.
    expect(r.data.committed.counterfactuals.knowledge)
      .not.toBe(r.data.committed.evidenceReference.knowledge);
  });
});

describe('B8-04 · a GUARDRAIL decision parses too', () => {
  const guardrail = {
    ...signal,
    decisionClass: 'GUARDRAIL',
    confidence: 0.9,
    baseConfidence: null,
    memoryProvenance: null,
    memoryStatus: 'NOT_CONSULTED',
    guardrailRuleId: 'r1',
    openHitKey: 'ws:r1:c1',
    committed: {
      // CANNOT_ASK — this class does not record these, and never will.
      ctrAtDecision:     { value: null, knowledge: 'CANNOT_ASK' },
      roasAtDecision:    { value: null, knowledge: 'CANNOT_ASK' },
      objective:         { value: null, knowledge: 'CANNOT_ASK' },
      channel:           { value: null, knowledge: 'CANNOT_ASK' },
      hypotheses:        { value: null, knowledge: 'CANNOT_ASK' },
      counterfactuals:   { value: null, knowledge: 'CANNOT_ASK' },
      evidenceReference: { value: { window: '30d' }, knowledge: 'KNOWN' },
    },
  };

  it('accepts an absent provenance and a CANNOT_ASK committed block', () => {
    const r = DecisionDetailSchema.safeParse(guardrail);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    if (!r.success) return;
    expect(r.data.memoryProvenance).toBeNull();
    expect(r.data.committed.hypotheses.knowledge).toBe('CANNOT_ASK');
  });

  it('admits a null confidence — C-16, an unmeasured call states none', () => {
    const r = DecisionDetailSchema.safeParse({ ...guardrail, confidence: null });
    expect(r.success).toBe(true);
  });
});

describe('B8-04 · the schema refuses what the backend cannot send', () => {
  it('rejects an unrecognised knowledge token rather than absorbing it', () => {
    const bad = { ...signal, committed: { ...signal.committed, objective: { value: 'x', knowledge: 'MAYBE' } } };
    expect(DecisionDetailSchema.safeParse(bad).success).toBe(false);
  });
});
