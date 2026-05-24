// ============================================================
// DiagnosisEngine
// ============================================================
// Single public API: diagnoseSignals(input)
//
// DETERMINISM CONTRACT:
//   Given the same input, always produces the same output.
//   No randomness.  No LLM calls.  No DB reads.
//
// ISOLATION CONTRACT:
//   Never writes to DB.  Never enqueues jobs.  Never calls routes.
//   Callers own persistence — pass the result to DecisionMemoryService.
// ============================================================
import { SIGNAL_RULES, HEALTHY_RESULT } from './signalRules.js';
import { logger }                        from '../../utils/logger.js';

const REQUIRED_FIELDS = ['ctr', 'cpc', 'cpm', 'frequency', 'spend', 'conversions'];

function validateInput(input) {
  if (input === null || input === undefined || typeof input !== 'object') {
    throw new Error('diagnoseSignals: input must be a non-null object');
  }
  for (const field of REQUIRED_FIELDS) {
    const val = input[field];
    if (val === undefined || val === null) {
      throw new Error(`diagnoseSignals: ${field} is required`);
    }
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(`diagnoseSignals: ${field} must be a finite number`);
    }
    if (val < 0) {
      throw new Error(`diagnoseSignals: ${field} must be non-negative`);
    }
  }
}

/**
 * Classifies a set of campaign performance signals into a single diagnosis.
 *
 * @param {{ ctr: number, cpc: number, cpm: number, frequency: number, spend: number, conversions: number }} input
 * @returns {{ signalType: string, diagnosis: string, confidence: number, reasons: string[] }}
 */
export function diagnoseSignals(input) {
  validateInput(input);

  for (const rule of SIGNAL_RULES) {
    if (rule.match(input)) {
      const result = {
        signalType: rule.signalType,
        diagnosis:  rule.diagnosis,
        confidence: rule.confidence,
        reasons:    rule.reasons(input),
      };

      logger.debug({
        signalType: result.signalType,
        diagnosis:  result.diagnosis,
        confidence: result.confidence,
      }, '[DiagnosisEngine] diagnosis resolved');

      return result;
    }
  }

  logger.debug({ signalType: HEALTHY_RESULT.signalType }, '[DiagnosisEngine] healthy');

  return {
    signalType: HEALTHY_RESULT.signalType,
    diagnosis:  HEALTHY_RESULT.diagnosis,
    confidence: HEALTHY_RESULT.confidence,
    reasons:    [...HEALTHY_RESULT.reasons],
  };
}
