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
// MISSING FIELDS SKIP RULES, THEY DO NOT THROW:
//   This used to validate six fields up front and throw if any was absent —
//   including `cpm`, which no rule has ever read. One unreported number
//   therefore destroyed the whole diagnosis, and the only way for a caller to
//   avoid that was to zero-fill. Zero-filling is precisely the fabrication the
//   rest of the system refuses (a null metric renders "—", never "0"), and it
//   is not harmless here: a zero-filled CTR is below every floor, so a campaign
//   with nothing reported would have been diagnosed LOW_CTR.
//   Now each rule declares what it reads; a rule whose inputs are absent is
//   skipped, and if NOTHING could be evaluated the answer is UNDIAGNOSABLE
//   rather than a confident HEALTHY.
//
//   A non-object input still throws — that is a programmer error, not missing data.
// ============================================================
import { SIGNAL_RULES, HEALTHY_RESULT, UNDIAGNOSABLE_RESULT, ruleIsEvaluable } from './signalRules.js';
import { getBenchmarks }                from '../verdict-engine/benchmarkProvider.js';
import { logger }                       from '../../utils/logger.js';

const freeze = (r) => ({
  signalType: r.signalType,
  diagnosis:  r.diagnosis,
  confidence: r.confidence,
  reasons:    [...r.reasons],
});

/**
 * Classifies a set of campaign performance signals into a single diagnosis.
 *
 * @param {object} input — signal-input shape (see verdictEngine.toSignalInput).
 *   Every field is OPTIONAL: an absent one skips the rules that read it.
 *   Money fields (`spendMinor`, `cpcMinor`) are MINOR UNITS; `ctr` is percent.
 * @param {object} [opts]
 * @param {string|null} [opts.objective] — platform objective. Selects the CTR
 *   bars via benchmarkProvider; null falls to DEFAULT, never to a global floor.
 * @returns {{ signalType: string, diagnosis: string, confidence: number,
 *   reasons: Array<{metric,value,benchmark,status,currency?}> }}
 */
export function diagnoseSignals(input, { objective = null } = {}) {
  if (input === null || input === undefined || typeof input !== 'object') {
    throw new Error('diagnoseSignals: input must be a non-null object');
  }

  const b = getBenchmarks(objective);
  let evaluatedAny = false;

  for (const rule of SIGNAL_RULES) {
    if (!ruleIsEvaluable(rule, input)) continue;
    evaluatedAny = true;

    if (rule.match(input, b)) {
      const result = {
        signalType: rule.signalType,
        diagnosis:  rule.diagnosis,
        confidence: rule.confidence,
        reasons:    rule.reasons(input, b),
      };

      logger.debug({
        signalType: result.signalType,
        diagnosis:  result.diagnosis,
        confidence: result.confidence,
        objective,
      }, '[DiagnosisEngine] diagnosis resolved');

      return result;
    }
  }

  // Nothing could be looked at ≠ nothing is wrong.
  if (!evaluatedAny) {
    logger.debug({ objective }, '[DiagnosisEngine] undiagnosable — no rule had its inputs');
    return freeze(UNDIAGNOSABLE_RESULT);
  }

  logger.debug({ signalType: HEALTHY_RESULT.signalType, objective }, '[DiagnosisEngine] healthy');
  return freeze(HEALTHY_RESULT);
}
