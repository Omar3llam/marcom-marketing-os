// ============================================================
// DiagnosisEngine
// ============================================================
// Single public API: diagnoseSignals(input, { objective })
//
// DETERMINISM CONTRACT:
//   Given the same input, always produces the same output.
//   No randomness.  No LLM calls.  No DB reads.
//
// ISOLATION CONTRACT:
//   Never writes to DB.  Never enqueues jobs.  Never calls routes.
//   Callers own persistence — pass the result to DecisionMemoryService.
//
// ── EVERY EVALUABLE RULE RUNS, AND DECLINED RULES KEEP THEIR NUMBERS ────────
//   This used to return on the first matching rule, and call reasons() only on
//   that winner. Two consequences, both fatal to the reasoning layer above:
//
//     • rules after the winner were never tested, so a second true diagnosis
//       was invisible — you cannot rank or eliminate what was never enumerated;
//     • a rule that ran and DECLINED produced no observation at all.
//
//   The second is the expensive one. Every counterfactual funnelDiagnosis emits
//   is built out of a measurement that PASSED — "Not a creative problem: CTR is
//   above the bar, so the ad is earning the click." The elimination IS the
//   healthy number. Discarding declined observations meant Stage 3 had nothing
//   to eliminate with, no matter what shape it asked for.
//
//   So: evaluate every evaluable rule, collect reasons() from all of them, and
//   return the fired ones and the declined ones separately. `declined` is not a
//   diagnostic — it is the counterfactual material, pre-computed once here so
//   no consumer ever re-derives it.
//
// ── MISSING FIELDS SKIP RULES, THEY DO NOT THROW ────────────────────────────
//   Six fields were once validated up front, including `cpm`, which no rule has
//   ever read. One unreported number destroyed the whole diagnosis, and the only
//   escape was zero-filling — the fabrication the rest of the system refuses
//   (a null metric renders "—", never "0"), and not a harmless one: a
//   zero-filled CTR is below every floor, so a row with nothing reported
//   diagnosed LOW_CTR.
//
//   A non-object input still throws — that is a programmer error, not missing data.
// ============================================================
import { SIGNAL_RULES, HEALTHY_RESULT, UNDIAGNOSABLE_RESULT, ruleIsEvaluable } from './signalRules.js';
import { getBenchmarks }                from '../verdict-engine/benchmarkProvider.js';
import { logger }                       from '../../utils/logger.js';

/**
 * Classifies campaign performance signals into ranked diagnoses.
 *
 * @param {object} input — signal-input shape (see verdictEngine.toSignalInput).
 *   Every field is OPTIONAL: an absent one skips the rules that read it.
 *   Money fields (`spendMinor`, `cpcMinor`) are MINOR UNITS; `ctr` is percent.
 * @param {object} [opts]
 * @param {string|null} [opts.objective] — platform objective. Selects the CTR
 *   bars via benchmarkProvider; null falls to DEFAULT, never to a global floor.
 *
 * @returns {{ signals: Signal[], declined: Signal[], undiagnosable: boolean }}
 *   `signals` is NEVER empty — it holds the fired rules (confidence desc), or a
 *   single HEALTHY, or a single UNDIAGNOSABLE. Keeping the terminal states
 *   inside the array rather than as bare flags is what lets every consumer read
 *   `signals[0].signalType` unconditionally, including the verdict engine's
 *   switch.
 *
 *   Signal: { signalType, diagnosis, confidence, observations, evaluable, fired }
 */
export function diagnoseSignals(input, { objective = null } = {}) {
  if (input === null || input === undefined || typeof input !== 'object') {
    throw new Error('diagnoseSignals: input must be a non-null object');
  }

  const b = getBenchmarks(objective);
  const fired = [];
  const declined = [];

  for (const rule of SIGNAL_RULES) {
    // A rule whose inputs were never reported is not evidence either way — it
    // belongs in NEITHER list. "We could not look" and "we looked and it was
    // fine" eliminate differently, and only the second is a counterfactual.
    if (!ruleIsEvaluable(rule, input)) continue;

    // Called for fired AND declined. On a declined rule these are the passing
    // measurements that rule OUT its diagnosis — status is derived, so they
    // come back 'healthy' rather than the hardcoded 'weak' they carried when
    // only the winner was ever asked.
    const observations = rule.reasons(input, b);

    if (rule.match(input, b)) {
      fired.push({
        signalType: rule.signalType,
        diagnosis:  rule.diagnosis,
        confidence: rule.confidence, // still a frozen literal — derivation is PR#317
        observations,
        evaluable:  true,
        fired:      true,
      });
    } else {
      declined.push({
        signalType: rule.signalType,
        diagnosis:  rule.diagnosis,
        confidence: rule.confidence,
        observations,
        evaluable:  true,
        fired:      false,
      });
    }
  }

  // Nothing could be looked at ≠ nothing is wrong.
  if (!fired.length && !declined.length) {
    logger.debug({ objective }, '[DiagnosisEngine] undiagnosable — no rule had its inputs');
    return { signals: [{ ...UNDIAGNOSABLE_RESULT, observations: [], evaluable: false, fired: false }], declined: [], undiagnosable: true };
  }

  if (!fired.length) {
    logger.debug({ objective }, '[DiagnosisEngine] healthy');
    return {
      signals: [{ ...HEALTHY_RESULT, observations: [], evaluable: true, fired: true }],
      declined,
      undiagnosable: false,
    };
  }

  // Highest confidence first. Today this reproduces declaration order exactly,
  // because the rule table is written in descending confidence (0.85 → 0.70) —
  // which is precisely why it must be explicit: first-match-wins WAS
  // highest-confidence-wins by coincidence of ordering, and nothing said so.
  // Array#sort is stable, so equal confidences keep declaration order.
  const signals = [...fired].sort((x, y) => y.confidence - x.confidence);

  logger.debug({
    signalType: signals[0].signalType,
    fired: signals.length,
    declined: declined.length,
    objective,
  }, '[DiagnosisEngine] diagnosis resolved');

  return { signals, declined, undiagnosable: false };
}
