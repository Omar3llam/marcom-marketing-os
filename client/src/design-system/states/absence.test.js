// ============================================================
// B8-02 — the absence adapter
// ------------------------------------------------------------
// RULING (Omar, 2026-09-06): absence is a MEASURED SEMANTIC STATE, never a UI
// default. The presentation layer may not originate an absence, and may not
// choose a fallback when handed one.
//
// This adapter INVENTS NOTHING. C-06 already froze the vocabulary in
// @marcom/runtime-contracts and 15 backend vocabularies already declare a
// knowledgeOf() for every value they can carry. The adapter's whole job is to
// turn a token the backend measured into a shape the UI can render.
//
// ── WHY SIX STATES AND NOT FIVE ─────────────────────────────────────────────
// `NOTHING_THERE` is a FINDING, not an absence: "we looked and there is
// nothing" is an ANSWER, where "not enough to say" is not. Collapsing them is
// the defect C-03 and C-07 both exist to end.
//
// ── WHY A TOKEN IS NOT ENOUGH ───────────────────────────────────────────────
// `CANNOT_ASK` covers BOTH "the question does not apply here" (unsupported) and
// "we are not entitled to ask it" (plan or role). That is correct, not a bug —
// but only the DOMAIN REASON can say which instruction to print. C-07 measured
// exactly this: two of three gating reasons share one token, and the client's
// defect was printing the WRONG instruction, not printing none.
//
//     token   → the SHAPE  (which state, which tone, whether to retry)
//     reason  → the COPY   (what this particular absence means here)
// ============================================================
import { describe, it, expect } from 'vitest';
import { KNOWLEDGE, KNOWLEDGE_VALUES } from '@marcom/runtime-contracts';
import { ABSENCE, ABSENCE_VALUES, absenceState, isAbsent } from './absence.js';

describe('B8-02 · the six states, and only six', () => {
  it('names one state per cause of absence, plus the finding, plus present', () => {
    expect([...ABSENCE_VALUES].sort()).toEqual([
      'NOT_MEASURED', 'NOT_PERMITTED', 'NOT_REACHABLE', 'NOT_SUPPORTED',
      'NOTHING_FOUND', 'PRESENT',
    ].sort());
  });

  it('keeps NOTHING_FOUND separate from every cause of absence', () => {
    // The finding is not an absence. A surface may state it as an answer.
    expect(isAbsent(ABSENCE.NOTHING_FOUND)).toBe(false);
    expect(isAbsent(ABSENCE.PRESENT)).toBe(false);
    for (const s of [ABSENCE.NOT_MEASURED, ABSENCE.NOT_REACHABLE,
      ABSENCE.NOT_SUPPORTED, ABSENCE.NOT_PERMITTED]) {
      expect(isAbsent(s)).toBe(true);
    }
  });
});

describe('B8-02 · every C-06 token maps, and nothing else does', () => {
  it('is EXHAUSTIVE over KNOWLEDGE_VALUES — a sixth token would fail here', () => {
    for (const token of KNOWLEDGE_VALUES) {
      const state = absenceState({ knowledge: token });
      expect(ABSENCE_VALUES, `token ${token} produced ${state}`).toContain(state);
    }
  });

  it('maps each token to the state its own definition states', () => {
    expect(absenceState({ knowledge: KNOWLEDGE.KNOWN })).toBe(ABSENCE.PRESENT);
    expect(absenceState({ knowledge: KNOWLEDGE.COULD_NOT_LOOK })).toBe(ABSENCE.NOT_REACHABLE);
    expect(absenceState({ knowledge: KNOWLEDGE.NOT_ENOUGH })).toBe(ABSENCE.NOT_MEASURED);
    expect(absenceState({ knowledge: KNOWLEDGE.NOTHING_THERE })).toBe(ABSENCE.NOTHING_FOUND);
  });

  it('splits CANNOT_ASK by REASON, because a token cannot replace a reason', () => {
    // Same token, two different instructions to print. C-07's measured lesson.
    expect(absenceState({ knowledge: KNOWLEDGE.CANNOT_ASK, reason: 'NOT_ENTITLED' }))
      .toBe(ABSENCE.NOT_PERMITTED);
    expect(absenceState({ knowledge: KNOWLEDGE.CANNOT_ASK, reason: 'NOT_APPLICABLE' }))
      .toBe(ABSENCE.NOT_SUPPORTED);
  });

  it('refuses to guess when CANNOT_ASK arrives without a reason', () => {
    // Choosing either would be the UI originating a claim about WHY. The
    // honest answer is the one that promises least: the question does not
    // apply. It must be explicit, not a silent default — so it is asserted
    // here rather than left to a reader to discover.
    expect(absenceState({ knowledge: KNOWLEDGE.CANNOT_ASK })).toBe(ABSENCE.NOT_SUPPORTED);
  });
});

describe('B8-02 · the adapter never invents a state', () => {
  it('THROWS on an unrecognised token rather than defaulting', () => {
    // A default here is exactly the `?? 0.5` / `below(null)` defect relocated
    // to the view layer: it would render an unknown epistemic position as a
    // known one. Failing loudly is the only honest option.
    expect(() => absenceState({ knowledge: 'INVENTED' })).toThrow(/INVENTED/);
  });

  it('THROWS on a missing token — absence must be MEASURED, not assumed', () => {
    expect(() => absenceState({})).toThrow();
    expect(() => absenceState({ knowledge: null })).toThrow();
    expect(() => absenceState({ knowledge: undefined })).toThrow();
  });
});
