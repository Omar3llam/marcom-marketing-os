// ============================================================
// B8-05 · R-E4 — one presentation rung, two domain vocabularies, no merge
// ------------------------------------------------------------
// EXPERIMENT is one decision class with two producers, and each producer wrote
// its own confidence vocabulary:
//
//   A/B      CONFIDENCE_LABEL   HIGH · MODERATE · LOW · INCONCLUSIVE
//                               free String column; INCONCLUSIVE is STORED
//   holdout  ConfidenceLevel    HIGH · MEDIUM   · LOW
//                               DB enum; a non-conclusive readout stores NULL
//
// Both surfaces render `{label} confidence`, so today the same rung prints
// "MODERATE confidence" in Testing and "MEDIUM confidence" in Measure, and
// "INCONCLUSIVE confidence" gives a FINDING the grammar of a MEASUREMENT —
// B8-01's L-4, which allows a confidence figure only where one was measured.
//
// THE RULING (R-E4) is a presentation adapter and NOTHING MORE. It does not
// unify the two enums, rename a value, or touch a column: that would be new
// truth, and a slice that defines new semantics has left B8. It only refuses to
// print two names as two different facts.
//
//   HIGH                  → HIGH
//   MODERATE · MEDIUM     → MEDIUM        (one rung, two spellings)
//   LOW                   → LOW
//   INCONCLUSIVE · null   → NO_CALL       a finding, never a band
//   anything else         → UNRECOGNISED  claims nothing
//
// The last line is the one with teeth. Today's code is
// `CONF_STYLE[label] || CONF_STYLE.INCONCLUSIVE`, which dresses an unknown
// label as a legitimate inconclusive result — contract drift rendered as a
// finding. This is the same defect B8-04b fixed one layer up ("an unrecognised
// token is not treated as KNOWN"), and it must not be reintroduced here.
//
// SCOPE OF THE INPUT: this maps the label of a readout that EXISTS. Whether a
// readout exists at all is a question about status, answered by R-E3 — see
// `HoldoutDetailView`. A null here means "concluded, and no call could be
// made", never "not run yet".
// ============================================================
import { describe, it, expect } from 'vitest';
import { CONFIDENCE, confidenceRung, isConfidenceBand } from './confidence.js';

describe('B8-05 · R-E4 — the two vocabularies land on one rung', () => {
  it('HIGH and LOW are spelled the same by both producers', () => {
    expect(confidenceRung('HIGH')).toBe(CONFIDENCE.HIGH);
    expect(confidenceRung('LOW')).toBe(CONFIDENCE.LOW);
  });

  it('MODERATE (A/B) and MEDIUM (holdout) are the SAME rung', () => {
    // The single assertion this ruling exists for.
    expect(confidenceRung('MODERATE')).toBe(confidenceRung('MEDIUM'));
    expect(confidenceRung('MODERATE')).toBe(CONFIDENCE.MEDIUM);
  });
});

describe('B8-05 · R-E4 — a finding is not a band', () => {
  it('INCONCLUSIVE is a finding, not a confidence level', () => {
    expect(confidenceRung('INCONCLUSIVE')).toBe(CONFIDENCE.NO_CALL);
    expect(isConfidenceBand(confidenceRung('INCONCLUSIVE'))).toBe(false);
  });

  it('null and undefined say the same thing INCONCLUSIVE says', () => {
    // Two producers encode "we could not call it" differently — one stores the
    // word, one stores nothing. The reader must not learn that difference.
    expect(confidenceRung(null)).toBe(CONFIDENCE.NO_CALL);
    expect(confidenceRung(undefined)).toBe(CONFIDENCE.NO_CALL);
    expect(confidenceRung('INCONCLUSIVE')).toBe(confidenceRung(null));
  });

  it('the three real bands ARE bands', () => {
    for (const rung of [CONFIDENCE.HIGH, CONFIDENCE.MEDIUM, CONFIDENCE.LOW]) {
      expect(isConfidenceBand(rung)).toBe(true);
    }
  });
});

describe('B8-05 · R-E4 — an unrecognised label claims nothing', () => {
  it('drift does not become a band', () => {
    expect(confidenceRung('VERY_HIGH')).toBe(CONFIDENCE.UNRECOGNISED);
    expect(isConfidenceBand(confidenceRung('VERY_HIGH'))).toBe(false);
  });

  it('drift does not silently inherit the INCONCLUSIVE result either', () => {
    // The defect being removed: `CONF_STYLE[label] || CONF_STYLE.INCONCLUSIVE`
    // made an unknown value LOOK like a real inconclusive readout. "We could
    // not call it" is a finding about the experiment; "we do not recognise this
    // value" is a fact about our contract. They are not the same sentence.
    expect(confidenceRung('VERY_HIGH')).not.toBe(CONFIDENCE.NO_CALL);
  });

  it('case and whitespace are not silently forgiven', () => {
    // A tolerant reader hides the drift it should surface.
    expect(confidenceRung('moderate')).toBe(CONFIDENCE.UNRECOGNISED);
    expect(confidenceRung(' HIGH ')).toBe(CONFIDENCE.UNRECOGNISED);
  });

  it('a non-string is unrecognised, not coerced', () => {
    expect(confidenceRung(0.9)).toBe(CONFIDENCE.UNRECOGNISED);
    expect(confidenceRung({})).toBe(CONFIDENCE.UNRECOGNISED);
  });
});

describe('B8-05 · R-E4 — the adapter covers both producers exhaustively', () => {
  it('every value either vocabulary can store maps to a declared rung', () => {
    // Derived from the two source vocabularies, not from this module's own
    // table — a mapper that defined its own idea of the inputs would pass this
    // by construction. If a producer adds a value, this list is what changes.
    const AB_LABELS      = ['HIGH', 'MODERATE', 'LOW', 'INCONCLUSIVE'];
    const HOLDOUT_LABELS = ['HIGH', 'MEDIUM', 'LOW', null];

    for (const label of [...AB_LABELS, ...HOLDOUT_LABELS]) {
      expect(confidenceRung(label)).not.toBe(CONFIDENCE.UNRECOGNISED);
      expect(Object.values(CONFIDENCE)).toContain(confidenceRung(label));
    }
  });
});
