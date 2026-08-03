// ============================================================
// Diagnosis Engine — signal rules
// ============================================================
// Rules are applied in declaration order.  First match wins.
// Priority (highest → lowest):
//   CREATIVE_FATIGUE > AUDIENCE_MISMATCH > INEFFICIENT_SCALING > LOW_CTR
//
// NOTE: `confidence` descends in that same order (0.85 → 0.70), so
// first-match-wins is ALSO highest-confidence-wins. That coupling is
// intentional but was never written down; if a rule is reordered or
// re-scored, the other must move with it or priority and confidence
// start disagreeing about which diagnosis is the strongest.
//
// ── CTR and frequency are OBJECTIVE-AWARE ───────────────────
// They used to be global constants here (CTR_WEAK 0.5, CTR_FATIGUE 1.0,
// FREQUENCY_HIGH 3.0). That is the exact defect benchmarkProvider was built to
// fix one layer up: a 0.4% CTR is weak for lead gen and entirely normal for a
// reach campaign, so a global floor diagnosed LOW_CTR on every awareness
// account. The bars now come from getBenchmarks(objective), and the saturation
// ceiling from the same FATIGUE_FREQ the verdict engine judges by — the two
// engines previously used 3.0 and 3.5 and disagreed about the same ad.
//
// ── Money thresholds are in MINOR UNITS, and are not converted ─
// They are calibrated in CURRENCY UNITS, not dollars: "50 units", not "$50".
// There is no FX table in this system and inventing one would be worse than
// stating the assumption — the same choice executionContext.js already made
// with MIN_SPEND_FOR_DIAGNOSIS ("~50 currency units"). What is fixed here is
// the fabricated "$" that used to be interpolated into every reason string on
// accounts that have never transacted in dollars.
// ============================================================
import { SIGNAL_TYPE, DIAGNOSIS } from './diagnosisTypes.js';
import { FATIGUE_FREQ } from '../verdict-engine/benchmarkProvider.js';

// Objective-independent thresholds only. Anything that varies by what the
// campaign is TRYING to do belongs in benchmarkProvider, not here.
const T = Object.freeze({
  SPEND_FLOOR_MINOR: 5_000, // 50 currency units — below this, efficiency signals are noise
  CPC_HIGH_MINOR:      200, // 2 currency units — elevated cost per click signals targeting issues
  CPL_HIGH_MINOR:    5_000, // 50 currency units — cost per conversion above this = inefficient
  CONV_RATE_LOW:      0.02, // ratio — < 2% click-to-conversion = poor audience fit
});

export { T as THRESHOLDS };

/** PURE: a real, usable number — null / NaN / negative all read as "absent". */
const has = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * PURE: one structured observation.
 *
 * Deliberately the SAME shape funnelDiagnosis's ev() and evidenceProvider's
 * evidenceItem() emit — { metric, value, benchmark, status } — so every layer
 * of the reasoning stack speaks one vocabulary and the client's EVIDENCE_UNITS
 * map (keyed on these UPPERCASE names) can render any of them.
 *
 * This replaces the pre-assembled English sentences `reasons()` used to return.
 * Those could not be translated (word order is baked in), could not survive an
 * RTL render (Latin digits and "%" need bidi isolation), and had to be parsed
 * to be reused — the failure that truncated the funnel counterfactual.
 *
 * `currency` rides only on money-valued rows, so a renderer never has to guess
 * whether a number is a count, a rate, or an amount.
 */
const obs = (metric, value, benchmark, status, currency = null) =>
  (currency ? { metric, value, benchmark, status, currency } : { metric, value, benchmark, status });

// ---------------------------------------------------------------------------
// Rule definitions
// Each rule: { signalType, diagnosis, confidence, requires[], match(i,b), reasons(i,b) }
//
// `requires` names the input fields the rule reads. A rule whose inputs were
// never reported is SKIPPED, not evaluated against zeros — the engine used to
// throw the entire diagnosis away when one field was missing, which pushed
// callers into zero-filling, which is the fabrication the whole graph layer
// refuses to do (a null metric renders "—", never "0").
// ---------------------------------------------------------------------------

export const SIGNAL_RULES = [
  // 1. CREATIVE_FATIGUE — audience has seen this creative too many times
  {
    signalType: SIGNAL_TYPE.CREATIVE_FATIGUE,
    diagnosis:  DIAGNOSIS.CREATIVE_FATIGUE,
    confidence: 0.85,
    requires:   ['frequency', 'ctr'],
    // >= matches verdictEngine's own fatigue test exactly. It used to be > 3.0
    // here and >= 3.5 there, so an ad at 3.2 was "fatigued" to one engine and
    // healthy to the other.
    match({ frequency, ctr }, b) {
      return frequency >= FATIGUE_FREQ && ctr < b.ctr.strong;
    },
    reasons({ frequency, ctr }, b) {
      return [
        obs('FREQUENCY', frequency, FATIGUE_FREQ, 'weak'),
        obs('CTR',       ctr,       b.ctr.strong, 'weak'),
      ];
    },
  },

  // 2. AUDIENCE_MISMATCH — targeting the wrong people (high CPC, few convert)
  {
    signalType: SIGNAL_TYPE.AUDIENCE_MISMATCH,
    diagnosis:  DIAGNOSIS.AUDIENCE_MISMATCH,
    confidence: 0.80,
    requires:   ['cpcMinor', 'spendMinor', 'conversions'],
    match({ cpcMinor, spendMinor, conversions }) {
      if (spendMinor < T.SPEND_FLOOR_MINOR || cpcMinor <= 0) return false;
      const clicks = spendMinor / cpcMinor;
      const convRate = clicks > 0 ? conversions / clicks : 0;
      return cpcMinor > T.CPC_HIGH_MINOR && convRate < T.CONV_RATE_LOW;
    },
    reasons({ cpcMinor, spendMinor, conversions, currency = null }) {
      const clicks = cpcMinor > 0 ? spendMinor / cpcMinor : 0;
      const convRate = clicks > 0 ? conversions / clicks : 0;
      return [
        obs('CPC',       cpcMinor, T.CPC_HIGH_MINOR, 'weak', currency),
        obs('CONV_RATE', convRate, T.CONV_RATE_LOW,  'weak'),
      ];
    },
  },

  // 3. INEFFICIENT_SCALING — budget is growing faster than results
  {
    signalType: SIGNAL_TYPE.INEFFICIENT_SCALING,
    diagnosis:  DIAGNOSIS.INEFFICIENT_SCALING,
    confidence: 0.75,
    requires:   ['spendMinor', 'conversions'],
    match({ spendMinor, conversions }) {
      if (spendMinor < T.SPEND_FLOOR_MINOR || conversions <= 0) return false;
      return (spendMinor / conversions) > T.CPL_HIGH_MINOR;
    },
    reasons({ spendMinor, conversions, currency = null }) {
      return [
        obs('CPL',   spendMinor / conversions, T.CPL_HIGH_MINOR, 'weak', currency),
        obs('SPEND', spendMinor,               null,             null,   currency),
      ];
    },
  },

  // 4. LOW_CTR — creative hook is not capturing attention
  {
    signalType: SIGNAL_TYPE.LOW_CTR,
    diagnosis:  DIAGNOSIS.LOW_CTR,
    confidence: 0.70,
    requires:   ['ctr'],
    match({ ctr }, b) {
      return ctr < b.ctr.weak;
    },
    reasons({ ctr }, b) {
      return [obs('CTR', ctr, b.ctr.weak, 'weak')];
    },
  },
];

/** PURE: can this rule be evaluated at all with the inputs we were given? */
export function ruleIsEvaluable(rule, input) {
  return rule.requires.every((f) => has(input[f]));
}

// Returned when rules ran and none fired — a real all-clear.
export const HEALTHY_RESULT = Object.freeze({
  signalType: SIGNAL_TYPE.HEALTHY,
  diagnosis:  DIAGNOSIS.HEALTHY,
  // Was 1.0, which sits above confidenceEngine's MAX_CONFIDENCE — the cap that
  // exists because platform-reported numbers carry attribution error invisible
  // from here, so certainty is never honest. Two scales that could not be
  // composed; now one.
  confidence: 0.97,
  reasons:    Object.freeze([]),
});

// Returned when NO rule could be evaluated. Not an all-clear — a statement that
// we could not look. reasons is empty because there is nothing observed to report.
export const UNDIAGNOSABLE_RESULT = Object.freeze({
  signalType: SIGNAL_TYPE.UNDIAGNOSABLE,
  diagnosis:  DIAGNOSIS.UNDIAGNOSABLE,
  confidence: 0,
  reasons:    Object.freeze([]),
});
