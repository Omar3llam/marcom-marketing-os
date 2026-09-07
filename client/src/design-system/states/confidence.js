// ============================================================
// The confidence rung — one presentation, two domain vocabularies (B8-05 R-E4)
// ------------------------------------------------------------
// EXPERIMENT is ONE decision class with two producers, and each wrote its own
// confidence vocabulary before there was a rule saying it should not:
//
//   A/B tests   CONFIDENCE_LABEL   HIGH · MODERATE · LOW · INCONCLUSIVE
//               (src/services/test-readout/testReadoutTypes.js)
//               a free String column; INCONCLUSIVE is STORED as a value
//
//   holdouts    ConfidenceLevel    HIGH · MEDIUM · LOW
//               (prisma enum)
//               a non-conclusive readout stores NULL
//
// Both halves rendered `{label} confidence`, so the same rung printed
// "MODERATE confidence" in Testing and "MEDIUM confidence" in Measure, and
// "INCONCLUSIVE confidence" gave a FINDING the grammar of a MEASUREMENT.
// B8-01's L-4 allows a confidence figure only where a confidence was measured.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
// It is not a unification. The two enums keep their values, their columns and
// their engines; nothing here renames, migrates or merges a thing. B8 makes
// existing truth legible — a slice that starts defining new semantics has left
// B8. All this module does is refuse to print two names as two facts.
//
// ── THE INPUT IS A READOUT'S LABEL ──────────────────────────────────────────
// `null` here means "concluded, and no call could be made". Whether a readout
// exists AT ALL is a different question, answered by status (R-E3) before this
// function is ever called: a DESIGNED holdout has not been read out, and its
// null must never reach here to be reported as a failed call.
// ============================================================

/** The rungs a reader can be shown. Three are bands; two are not. */
export const CONFIDENCE = Object.freeze({
  HIGH:   'HIGH',
  MEDIUM: 'MEDIUM',
  LOW:    'LOW',
  /** A finding: the readout ran and could not call it. */
  NO_CALL: 'NO_CALL',
  /** Contract drift: a value neither producer is known to write. Claims nothing. */
  UNRECOGNISED: 'UNRECOGNISED',
});

// Every value either producer can store, mapped explicitly. MODERATE and MEDIUM
// are the same rung under two spellings — the single fact this table exists for.
const RUNG = Object.freeze({
  HIGH:         CONFIDENCE.HIGH,
  MODERATE:     CONFIDENCE.MEDIUM,   // A/B
  MEDIUM:       CONFIDENCE.MEDIUM,   // holdout
  LOW:          CONFIDENCE.LOW,
  INCONCLUSIVE: CONFIDENCE.NO_CALL,  // A/B stores the word…
});

/**
 * PURE: the rung to present for a stored confidence label.
 *
 * Absent (null/undefined) is NO_CALL: the holdout half encodes "we could not
 * call it" by storing nothing, where the A/B half stores INCONCLUSIVE. A reader
 * must not have to learn which producer wrote the row.
 *
 * Anything else is UNRECOGNISED, and that is the line with teeth. The code this
 * replaced was `CONF_STYLE[label] || CONF_STYLE.INCONCLUSIVE`, which dressed an
 * unknown value as a legitimate inconclusive result — drift rendered as a
 * finding. "We could not call it" is a fact about the experiment; "we do not
 * recognise this value" is a fact about our contract. Matching is exact: a
 * tolerant reader (case-folding, trimming) hides the drift it should surface.
 */
export function confidenceRung(label) {
  if (label == null) return CONFIDENCE.NO_CALL;
  if (typeof label !== 'string') return CONFIDENCE.UNRECOGNISED;
  return RUNG[label] ?? CONFIDENCE.UNRECOGNISED;
}

/** PURE: is this rung an actual measurement, as opposed to a finding about one? */
export function isConfidenceBand(rung) {
  return rung === CONFIDENCE.HIGH || rung === CONFIDENCE.MEDIUM || rung === CONFIDENCE.LOW;
}

/**
 * The sentence for a rung. A band names itself; the other two do not borrow the
 * word "confidence", because neither of them is one.
 */
export function confidenceText(rung) {
  switch (rung) {
    case CONFIDENCE.HIGH:   return 'High confidence';
    case CONFIDENCE.MEDIUM: return 'Medium confidence';
    case CONFIDENCE.LOW:    return 'Low confidence';
    case CONFIDENCE.NO_CALL: return 'No call could be made';
    default: return 'Confidence not recognised';
  }
}
