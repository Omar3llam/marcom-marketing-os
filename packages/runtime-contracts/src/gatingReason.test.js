// ============================================================
// gatingReason — C-07 contract tests 1, 3, 4 (vocabulary layer)
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  GATING_REASON, GATING_REASON_VALUES,
  PREREQUISITE, PREREQUISITE_VALUES,
  GATING_REASONS, declareGatingReasons,
  knowledgeOfGatingReason, prerequisiteOfGatingReason,
  isGatingReason, withGatingKnowledge,
  GatingReasonDeclarationError, UndeclaredGatingReasonError,
} from './gatingReason.js';
import { KNOWLEDGE } from './epistemicStatus.js';

describe('C-07 · test 1 — the three reasons are declared, and a declaration is total', () => {
  it('declares every reason the vocabulary carries', () => {
    expect(GATING_REASON_VALUES).toHaveLength(3);
    for (const reason of GATING_REASON_VALUES) {
      expect(GATING_REASONS.declarationOf(reason)).toBeTruthy();
    }
  });

  it('throws when a reason has no declaration — at module load, not on the wire', () => {
    expect(() => declareGatingReasons(
      { A: 'A', B: 'B' },
      { A: { knowledge: KNOWLEDGE.NOTHING_THERE, prerequisite: PREREQUISITE.DELIVERY } },
    )).toThrow(GatingReasonDeclarationError);
  });

  it('throws when a declaration omits the knowledge token', () => {
    expect(() => declareGatingReasons(
      { A: 'A' }, { A: { prerequisite: PREREQUISITE.DELIVERY } },
    )).toThrow(GatingReasonDeclarationError);
  });

  it('throws when a declaration omits the prerequisite', () => {
    // THE POINT OF C-07. A reason that does not say what would open the road is
    // a label, not an explanation — and the client then invents an instruction.
    expect(() => declareGatingReasons(
      { A: 'A' }, { A: { knowledge: KNOWLEDGE.NOTHING_THERE } },
    )).toThrow(GatingReasonDeclarationError);
  });

  it('throws on a declaration the vocabulary does not contain', () => {
    expect(() => declareGatingReasons(
      { A: 'A' },
      {
        A: { knowledge: KNOWLEDGE.NOTHING_THERE, prerequisite: PREREQUISITE.DELIVERY },
        GHOST: { knowledge: KNOWLEDGE.NOTHING_THERE, prerequisite: PREREQUISITE.DELIVERY },
      },
    )).toThrow(GatingReasonDeclarationError);
  });

  it('rejects a knowledge token or prerequisite outside its own vocabulary', () => {
    expect(() => declareGatingReasons(
      { A: 'A' }, { A: { knowledge: 'MAYBE', prerequisite: PREREQUISITE.DELIVERY } },
    )).toThrow(GatingReasonDeclarationError);
    expect(() => declareGatingReasons(
      { A: 'A' }, { A: { knowledge: KNOWLEDGE.NOTHING_THERE, prerequisite: 'TRY_HARDER' } },
    )).toThrow(GatingReasonDeclarationError);
  });
});

describe('C-07 · test 3 — the token cannot substitute for the reason', () => {
  it('two reasons share NOTHING_THERE and still name different prerequisites', () => {
    // Lumi knows EXACTLY as much about both absences. The fixes have nothing in
    // common. This is the whole argument for two orthogonal vocabularies, and it
    // is measured rather than asserted in prose.
    expect(knowledgeOfGatingReason(GATING_REASON.NO_MEASURABLE_DELIVERY))
      .toBe(KNOWLEDGE.NOTHING_THERE);
    expect(knowledgeOfGatingReason(GATING_REASON.NO_CANONICAL_WINDOW))
      .toBe(KNOWLEDGE.NOTHING_THERE);

    expect(prerequisiteOfGatingReason(GATING_REASON.NO_MEASURABLE_DELIVERY))
      .not.toBe(prerequisiteOfGatingReason(GATING_REASON.NO_CANONICAL_WINDOW));
  });

  it('every reason names a distinct prerequisite', () => {
    const prereqs = GATING_REASON_VALUES.map(prerequisiteOfGatingReason);
    expect(new Set(prereqs).size).toBe(GATING_REASON_VALUES.length);
    for (const p of prereqs) expect(PREREQUISITE_VALUES).toContain(p);
  });

  it('stale evidence is NOT_ENOUGH — we measured it, and it does not suffice today', () => {
    expect(knowledgeOfGatingReason(GATING_REASON.CANONICAL_EVIDENCE_STALE))
      .toBe(KNOWLEDGE.NOT_ENOUGH);
  });

  it('an unrecognised reason yields null, never a guessed token', () => {
    expect(knowledgeOfGatingReason('SOMETHING_NEW')).toBeNull();
    expect(prerequisiteOfGatingReason(undefined)).toBeNull();
    expect(isGatingReason('no measured revenue or engagement')).toBe(false);
  });
});

describe('C-07 · test 2 — an undeclared reason cannot reach the wire', () => {
  it('withGatingKnowledge throws at the producer boundary', () => {
    expect(() => withGatingKnowledge({ id: 'a', name: 'A', reason: 'FRESHLY_INVENTED' }))
      .toThrow(UndeclaredGatingReasonError);
  });

  it('decorates a declared reason with its knowledge and prerequisite, keeping every other field', () => {
    const decorated = withGatingKnowledge({
      id: 'B', name: 'B', reason: GATING_REASON.CANONICAL_EVIDENCE_STALE,
      measurementAgeDays: 42, windowEnd: '2026-01-01', maxAgeDays: 3,
    });
    expect(decorated).toEqual({
      id: 'B', name: 'B',
      reason: GATING_REASON.CANONICAL_EVIDENCE_STALE,
      knowledge: KNOWLEDGE.NOT_ENOUGH,
      prerequisite: PREREQUISITE.FRESH_MEASUREMENT,
      measurementAgeDays: 42, windowEnd: '2026-01-01', maxAgeDays: 3,
    });
  });
});
