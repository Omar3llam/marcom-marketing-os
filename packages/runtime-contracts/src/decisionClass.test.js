// ============================================================
// C-10 · DECISION_CLASS — the registry
// ------------------------------------------------------------
// On trunk there is no decision-class vocabulary at all. The class is a string
// PREFIX on `rootCause`, owned privately by five writers:
//
//   VerdictService          a signalType / rootCause / null  (the only shared set)
//   GuardrailSweepService   `guardrail:`      ← a bare literal, in three files
//   AllocationService       `allocation:`     ← a private const
//   IncrementalityService   `incrementality:` ← a private const named MEMORY_PREFIX
//   TestTrackerService      `test:`           ← a private const, DECLARED TWICE
//
// `decisionIdentity.js` lists all five in a COMMENT and defines exactly one of
// them. The other four are defined by SUBTRACTION: a class is "not Signal".
//
// The measured cost of that: NarrativeService needs the class and re-derives it
// with its own regex, `/^allocation:([0-9a-f-]+)/i`. When a consumer writes a
// parser to learn what kind of row it is holding, the class is not metadata
// hidden in a string — it is identity, and it needs a name.
//
// The CLASSIFIER is not tested here, and does not live here: it needs the real
// connector cause set, which this package does not have. See
// src/services/decisions/decisionClassifier.test.js.
// ============================================================
import { describe, it, expect } from 'vitest';
import { DECISION_CLASS, DECISION_CLASS_VALUES, isDecisionClass } from './decisionClass.js';

describe('the registry', () => {
  it('names exactly four classes', () => {
    expect([...DECISION_CLASS_VALUES].sort()).toEqual(
      ['ALLOCATION', 'EXPERIMENT', 'GUARDRAIL', 'SIGNAL'],
    );
    // Frozen: a class is identity, and identity does not get patched at runtime.
    expect(Object.isFrozen(DECISION_CLASS)).toBe(true);
  });

  it('keeps ALLOCATION, because AllocationService writes Decision rows today', () => {
    // Whether a REALLOCATE proposal SHOULD live in `decisions` is a real and
    // open architectural question. It is not this one. Dropping the class of a
    // row that exists would leave it NULL — which means "unclassified" — and
    // that is a false statement about a producer we know exactly, as well as
    // merging allocation moves with genuinely unclassifiable legacy rows under
    // one predicate.
    expect(DECISION_CLASS.ALLOCATION).toBe('ALLOCATION');
  });

  it('recognises its own members and nothing else', () => {
    for (const v of DECISION_CLASS_VALUES) expect(isDecisionClass(v)).toBe(true);
    // The four prefixes are NOT the class. A caller passing the encoding it
    // found on a row must be told it did not pass a class.
    for (const notAClass of ['guardrail:', 'allocation:', 'test:', 'signal', null, undefined, '']) {
      expect(isDecisionClass(notAClass)).toBe(false);
    }
  });

  it('ships no classifier — the client receives the class, it never derives one', () => {
    // A `classifyRootCause` here could only recognise a connector cause by
    // SHAPE, and a shape cannot tell a live enum member from one deleted last
    // year. Both would answer SIGNAL, which is the invention T3 forbids.
    return import('./decisionClass.js').then((mod) => {
      expect(Object.keys(mod)).not.toContain('classifyRootCause');
    });
  });
});
